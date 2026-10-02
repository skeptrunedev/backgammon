/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' in the native-app build (`vite build --mode native`). */
  readonly VITE_NATIVE?: string;
  /** Absolute API origin for the native-app build, e.g. https://bg.skeptrune.com. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
