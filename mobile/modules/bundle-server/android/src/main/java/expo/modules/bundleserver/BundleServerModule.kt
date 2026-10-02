package expo.modules.bundleserver

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileNotFoundException

private const val WWW = "www"

class BundleServerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BundleServer")

    // Starts (or confirms) the loopback server for the bundled PWA and resolves
    // with its origin, e.g. "http://localhost:47123".
    AsyncFunction("start") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val assets = context.applicationContext.assets
      try {
        assets.open("$WWW/${StaticHttpServer.INDEX}").close()
      } catch (e: FileNotFoundException) {
        throw CodedException(
          "ERR_NO_BUNDLE",
          "The web bundle is missing from the app (run scripts/build-web.sh before building)",
          e,
        )
      }
      val port = server(assets).start(PORTS)
      "http://localhost:$port"
    }
  }

  companion object {
    /** Fixed first choice: the origin (and with it IndexedDB/localStorage) must stay stable across launches. */
    val PORTS = (47123..47132).toList()

    @Volatile private var shared: StaticHttpServer? = null

    // One server per process; it outlives module/bridge reloads.
    @Synchronized
    private fun server(assets: android.content.res.AssetManager): StaticHttpServer =
      shared ?: StaticHttpServer { path ->
        try {
          assets.open("$WWW/$path")
        } catch (e: java.io.IOException) {
          null
        }
      }.also { shared = it }
  }
}
