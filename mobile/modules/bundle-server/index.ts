import { NativeModule, requireNativeModule } from 'expo';

declare class BundleServerModule extends NativeModule {
  /**
   * Starts (or confirms) the in-app loopback HTTP server that serves the bundled
   * PWA and resolves with its origin, e.g. "http://localhost:47123". Call it
   * again when the app returns to the foreground; it is idempotent.
   */
  start(): Promise<string>;
}

export default requireNativeModule<BundleServerModule>('BundleServer');
