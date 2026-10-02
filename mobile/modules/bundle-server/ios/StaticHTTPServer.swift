import Foundation
import Network

/// A minimal static HTTP/1.1 server for the bundled PWA, listening on the
/// loopback interface only.
///
/// The WKWebView loads the app from http://localhost:<port>: a real http origin
/// and a secure context, so the PWA's module scripts, Web Worker, WebAssembly
/// and IndexedDB behave exactly as on bg.skeptrune.com. (A WKURLSchemeHandler
/// custom scheme was rejected: WebKit restricts workers and fetch on custom
/// schemes, and the gnubg engine needs both.)
///
/// Plain GET/HEAD, one request per connection (Connection: close), no caching
/// (files only change with an app update). Unknown extensionless paths fall
/// back to index.html so the SPA's client-side routes resolve on reload.
final class StaticHTTPServer {
  static let index = "index.html"

  private let root: URL
  private let queue = DispatchQueue(label: "com.skeptrune.backgammon.bundle-server")
  private var listener: NWListener?
  private var port: UInt16?
  /// The last port we served on: tried first so the origin (and the storage
  /// WebKit keys by origin) stays the same across restarts.
  private var lastPort: UInt16?
  /// Callers waiting on an in-flight start.
  private var waiting: [(Result<UInt16, Error>) -> Void] = []

  init(root: URL) {
    self.root = root.standardizedFileURL
  }

  /// Starts listening on the first free port in `ports`, or reports the port it
  /// is already serving on. Safe to call again after the app returns from the
  /// background: a listener the OS tore down is replaced.
  func start(ports: [UInt16], completion: @escaping (Result<UInt16, Error>) -> Void) {
    queue.async {
      if let listener = self.listener, listener.state == .ready, let port = self.port {
        completion(.success(port))
        return
      }
      self.waiting.append(completion)
      guard self.waiting.count == 1 else { return }  // a start is already in flight
      self.listener?.cancel()
      self.listener = nil
      self.port = nil
      var ordered = ports
      if let last = self.lastPort {
        ordered = [last] + ports.filter { $0 != last }
      }
      self.listen(on: ordered[...], lastError: nil)
    }
  }

  private func settle(_ result: Result<UInt16, Error>) {
    let callbacks = waiting
    waiting = []
    callbacks.forEach { $0(result) }
  }

  private func listen(on ports: ArraySlice<UInt16>, lastError: Error?) {
    guard let candidate = ports.first, let nwPort = NWEndpoint.Port(rawValue: candidate) else {
      settle(.failure(lastError ?? ServerError.noFreePort))
      return
    }
    let parameters = NWParameters.tcp
    parameters.requiredInterfaceType = .loopback
    parameters.allowLocalEndpointReuse = true

    let listener: NWListener
    do {
      listener = try NWListener(using: parameters, on: nwPort)
    } catch {
      listen(on: ports.dropFirst(), lastError: error)
      return
    }
    self.listener = listener

    var started = false
    listener.stateUpdateHandler = { [weak self, weak listener] state in
      guard let self, let listener, self.listener === listener else { return }
      switch state {
      case .ready:
        guard !started else { return }
        started = true
        self.port = candidate
        self.lastPort = candidate
        self.settle(.success(candidate))
      case .failed(let error), .waiting(let error):
        listener.cancel()
        self.listener = nil
        self.port = nil
        if !started {
          // Port taken (or unusable): try the next one.
          self.listen(on: ports.dropFirst(), lastError: error)
        }
        // If it dies after starting (reclaimed while suspended), the next
        // start() call binds a fresh listener.
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener.start(queue: queue)
  }

  // MARK: - Connections

  private func accept(_ connection: NWConnection) {
    guard Self.isLoopback(connection.endpoint) else {
      connection.cancel()
      return
    }
    connection.start(queue: queue)
    receiveHead(on: connection, buffer: Data())
  }

  private func receiveHead(on connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) {
      [weak self] data, _, isComplete, error in
      guard let self else {
        connection.cancel()
        return
      }
      var buffer = buffer
      if let data { buffer.append(data) }
      if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
        let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
        self.respond(on: connection, head: head)
      } else if error != nil || isComplete || buffer.count > 16 * 1024 {
        connection.cancel()
      } else {
        self.receiveHead(on: connection, buffer: buffer)
      }
    }
  }

  private func respond(on connection: NWConnection, head: String) {
    let requestLine = head.components(separatedBy: "\r\n").first ?? ""
    let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count >= 3 else {
      return send(on: connection, status: 400, reason: "Bad Request")
    }
    let method = String(parts[0])
    guard method == "GET" || method == "HEAD" else {
      return send(on: connection, status: 405, reason: "Method Not Allowed")
    }
    guard let relativePath = resolve(target: String(parts[1])),
      let body = try? Data(contentsOf: root.appendingPathComponent(relativePath), options: .mappedIfSafe)
    else {
      return send(on: connection, status: 404, reason: "Not Found")
    }
    var response = Self.headers(
      status: 200, reason: "OK", contentType: Self.contentType(for: relativePath), length: body.count)
    if method == "GET" { response.append(body) }
    finish(connection, with: response)
  }

  /// Maps a request target to a file path inside `root`, or nil for a 404.
  /// Rejects traversal; serves index.html for "/" and for extensionless paths
  /// that aren't files (client-side routes).
  func resolve(target: String) -> String? {
    var rawPath = Substring(target)
    if let cut = rawPath.firstIndex(where: { $0 == "?" || $0 == "#" }) {
      rawPath = rawPath[rawPath.startIndex..<cut]
    }
    guard rawPath.hasPrefix("/") else { return nil }
    var segments: [String] = []
    for raw in rawPath.split(separator: "/") {
      guard let segment = String(raw).removingPercentEncoding,
        segment != ".", segment != "..",
        !segment.contains("/"), !segment.contains("\\")
      else { return nil }
      segments.append(segment)
    }
    if segments.isEmpty { return Self.index }
    let path = segments.joined(separator: "/")
    var isDirectory: ObjCBool = false
    let exists = FileManager.default.fileExists(
      atPath: root.appendingPathComponent(path).path, isDirectory: &isDirectory)
    if exists && !isDirectory.boolValue { return path }
    return segments.last!.contains(".") ? nil : Self.index
  }

  private func send(on connection: NWConnection, status: Int, reason: String) {
    let body = Data(reason.utf8)
    var response = Self.headers(
      status: status, reason: reason, contentType: "text/plain; charset=utf-8", length: body.count)
    response.append(body)
    finish(connection, with: response)
  }

  private func finish(_ connection: NWConnection, with response: Data) {
    connection.send(
      content: response, contentContext: .finalMessage, isComplete: true,
      completion: .contentProcessed { _ in connection.cancel() })
  }

  // MARK: - Helpers

  private static func headers(status: Int, reason: String, contentType: String, length: Int) -> Data {
    let head =
      "HTTP/1.1 \(status) \(reason)\r\n"
      + "Content-Type: \(contentType)\r\n"
      + "Content-Length: \(length)\r\n"
      + "Cache-Control: no-store\r\n"
      + "X-Content-Type-Options: nosniff\r\n"
      + "Connection: close\r\n\r\n"
    return Data(head.utf8)
  }

  private static func isLoopback(_ endpoint: NWEndpoint) -> Bool {
    guard case .hostPort(let host, _) = endpoint else { return false }
    switch host {
    case .ipv4(let address): return address.isLoopback
    case .ipv6(let address): return address.isLoopback
    case .name(let name, _): return name == "localhost"
    @unknown default: return false
    }
  }

  private static let mimeTypes: [String: String] = [
    "html": "text/html; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
    "mjs": "text/javascript; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "json": "application/json",
    "webmanifest": "application/manifest+json",
    "map": "application/json",
    "wasm": "application/wasm",
    "data": "application/octet-stream",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "ico": "image/x-icon",
    "woff": "font/woff",
    "woff2": "font/woff2",
    "ttf": "font/ttf",
    "txt": "text/plain; charset=utf-8",
  ]

  static func contentType(for path: String) -> String {
    let ext = (path as NSString).pathExtension.lowercased()
    return mimeTypes[ext] ?? "application/octet-stream"
  }

  enum ServerError: LocalizedError {
    case noFreePort
    var errorDescription: String? { "No free loopback port for the bundled web app" }
  }
}
