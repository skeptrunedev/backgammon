import ExpoModulesCore

public class BundleServerModule: Module {
  /// Fixed first choice: the origin (and with it IndexedDB/localStorage) must
  /// stay stable across launches.
  private static let ports: [UInt16] = Array(47123...47132)

  /// One server per process; it outlives module/bridge reloads.
  private static var server: StaticHTTPServer?

  public func definition() -> ModuleDefinition {
    Name("BundleServer")

    // Starts (or confirms) the loopback server for the bundled PWA and resolves
    // with its origin, e.g. "http://localhost:47123".
    AsyncFunction("start") { (promise: Promise) in
      guard let server = Self.sharedServer() else {
        promise.reject(
          "ERR_NO_BUNDLE",
          "The web bundle is missing from the app (run scripts/build-web.sh before building)")
        return
      }
      server.start(ports: Self.ports) { result in
        switch result {
        case .success(let port):
          promise.resolve("http://localhost:\(port)")
        case .failure(let error):
          promise.reject("ERR_SERVER_START", error.localizedDescription)
        }
      }
    }.runOnQueue(.main)
  }

  private static func sharedServer() -> StaticHTTPServer? {
    if let server { return server }
    guard let root = wwwRoot() else { return nil }
    let created = StaticHTTPServer(root: root)
    server = created
    return created
  }

  /// The PWA build ships as a `www` folder resource: in the main bundle for
  /// static pods, or in this pod's framework bundle when frameworks are dynamic.
  private static func wwwRoot() -> URL? {
    for bundle in [Bundle.main, Bundle(for: BundleServerModule.self)] {
      if let url = bundle.url(forResource: "www", withExtension: nil),
        FileManager.default.fileExists(atPath: url.appendingPathComponent(StaticHTTPServer.index).path)
      {
        return url
      }
    }
    return nil
  }
}
