package expo.modules.bundleserver

import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URLDecoder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Where the served files come from (APK assets on Android, a directory in tests). */
fun interface FileSource {
  /** Opens `path` (relative, e.g. "assets/index-abc.js"), or returns null if it doesn't exist. */
  fun open(path: String): InputStream?
}

/**
 * A minimal static HTTP/1.1 server for the bundled PWA, bound to 127.0.0.1 only.
 *
 * The WebView loads the app from http://localhost:<port>, a real origin and a
 * secure context, so the PWA's module scripts, Web Worker, WebAssembly and
 * IndexedDB behave exactly as on bg.skeptrune.com. Plain GET/HEAD, one request
 * per connection (Connection: close), no caching (the files only change with an
 * app update). Unknown extensionless paths fall back to index.html so the SPA's
 * client-side routes (/play/:id, /trends...) resolve on reload.
 */
class StaticHttpServer(private val source: FileSource) {
  private var serverSocket: ServerSocket? = null
  private var executor: ExecutorService? = null

  val port: Int?
    @Synchronized get() = serverSocket?.takeIf { !it.isClosed }?.localPort

  /** Binds the first free port in `ports` and starts serving. Idempotent while running. */
  @Synchronized
  fun start(ports: List<Int>): Int {
    port?.let { return it }
    var lastError: IOException? = null
    for (candidate in ports) {
      val socket = ServerSocket()
      try {
        socket.reuseAddress = true
        socket.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), candidate), 64)
      } catch (e: IOException) {
        socket.close()
        lastError = e
        continue
      }
      val pool = Executors.newCachedThreadPool { r ->
        Thread(r, "bundle-server").apply { isDaemon = true }
      }
      serverSocket = socket
      executor = pool
      pool.execute { acceptLoop(socket, pool) }
      return candidate
    }
    throw IOException("No free loopback port in $ports", lastError)
  }

  @Synchronized
  fun stop() {
    serverSocket?.close()
    serverSocket = null
    executor?.shutdownNow()
    executor = null
  }

  private fun acceptLoop(socket: ServerSocket, pool: ExecutorService) {
    while (!socket.isClosed) {
      val client = try {
        socket.accept()
      } catch (e: SocketException) {
        return // closed by stop()
      } catch (e: IOException) {
        continue
      }
      pool.execute { client.use { handle(it) } }
    }
  }

  private fun handle(client: Socket) {
    client.soTimeout = 10_000
    val head = readHead(client.getInputStream()) ?: return
    val out = BufferedOutputStream(client.getOutputStream(), 64 * 1024)
    val requestLine = head.substringBefore("\r\n").split(' ')
    if (requestLine.size < 3) return writeStatus(out, 400, "Bad Request")
    val method = requestLine[0]
    if (method != "GET" && method != "HEAD") return writeStatus(out, 405, "Method Not Allowed")
    val resolved = resolve(requestLine[1]) ?: return writeStatus(out, 404, "Not Found")
    val stream = source.open(resolved) ?: return writeStatus(out, 404, "Not Found")
    val body = stream.use { it.readBytes() }
    writeHeaders(out, 200, "OK", contentType(resolved), body.size.toLong())
    if (method == "GET") out.write(body)
    out.flush()
  }

  /**
   * Maps a request target to a file path inside the bundle, or null for a 404.
   * Rejects traversal; serves index.html for "/" and for extensionless paths
   * that aren't files (client-side routes).
   */
  internal fun resolve(target: String): String? {
    val rawPath = target.substringBefore('?').substringBefore('#')
    if (!rawPath.startsWith("/")) return null
    val segments = try {
      // Percent-decoding only: URLDecoder would also turn a literal "+" into a space.
      rawPath.split('/').filter { it.isNotEmpty() }
        .map { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }
    } catch (e: IllegalArgumentException) {
      return null
    }
    if (segments.any { it == "." || it == ".." || it.contains('/') || it.contains('\\') }) return null
    if (segments.isEmpty()) return INDEX
    val path = segments.joinToString("/")
    if (exists(path)) return path
    return if ('.' in segments.last()) null else INDEX
  }

  private fun exists(path: String): Boolean = source.open(path)?.let { it.close(); true } ?: false

  private fun readHead(input: InputStream): String? {
    val buf = StringBuilder()
    while (buf.length < MAX_HEAD) {
      val b = try { input.read() } catch (e: IOException) { return null }
      if (b < 0) return null
      buf.append(b.toChar())
      if (buf.endsWith("\r\n\r\n")) return buf.toString()
    }
    return null
  }

  private fun writeStatus(out: BufferedOutputStream, code: Int, reason: String) {
    val body = reason.toByteArray()
    writeHeaders(out, code, reason, "text/plain; charset=utf-8", body.size.toLong())
    out.write(body)
    out.flush()
  }

  private fun writeHeaders(out: BufferedOutputStream, code: Int, reason: String, type: String, length: Long) {
    val headers = "HTTP/1.1 $code $reason\r\n" +
      "Content-Type: $type\r\n" +
      "Content-Length: $length\r\n" +
      "Cache-Control: no-store\r\n" +
      "X-Content-Type-Options: nosniff\r\n" +
      "Connection: close\r\n\r\n"
    out.write(headers.toByteArray(Charsets.ISO_8859_1))
  }

  companion object {
    const val INDEX = "index.html"
    private const val MAX_HEAD = 16 * 1024

    private val MIME = mapOf(
      "html" to "text/html; charset=utf-8",
      "js" to "text/javascript; charset=utf-8",
      "mjs" to "text/javascript; charset=utf-8",
      "css" to "text/css; charset=utf-8",
      "json" to "application/json",
      "webmanifest" to "application/manifest+json",
      "map" to "application/json",
      "wasm" to "application/wasm",
      "data" to "application/octet-stream",
      "svg" to "image/svg+xml",
      "png" to "image/png",
      "jpg" to "image/jpeg",
      "jpeg" to "image/jpeg",
      "webp" to "image/webp",
      "ico" to "image/x-icon",
      "woff" to "font/woff",
      "woff2" to "font/woff2",
      "ttf" to "font/ttf",
      "txt" to "text/plain; charset=utf-8",
    )

    fun contentType(path: String): String =
      MIME[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"
  }
}
