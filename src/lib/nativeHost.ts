// Messages from the bundled PWA to the native app shell (mobile/). Only the
// native build has a host; on the web these helpers are never reached.

export type NativeHostMessage = {
  /** Hand a text file to the OS share sheet (Save to Files, AirDrop, Drive...). */
  type: 'shareFile';
  filename: string;
  mimeType: string;
  text: string;
};

interface ReactNativeWebViewBridge {
  postMessage(message: string): void;
}

export function postToNativeHost(message: NativeHostMessage): boolean {
  const bridge = (window as unknown as { ReactNativeWebView?: ReactNativeWebViewBridge })
    .ReactNativeWebView;
  if (!bridge) return false;
  bridge.postMessage(JSON.stringify(message));
  return true;
}
