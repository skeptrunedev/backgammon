import { useEffect, useRef } from 'react';
import { ENGINE_HTML } from './engineHtml';
import { getEngine } from './nativeClient';

/**
 * Web build of the engine host. React Native's react-native-webview has no web
 * implementation, but on web we're already in a browser — so we run the gnubg
 * WASM engine in a hidden <iframe> and bridge over window.postMessage. The
 * engine's assets are served locally from /engine (public/engine/*), so relative
 * paths in ENGINE_HTML resolve against the dev server, same as the native host.
 */
export function EngineWebView() {
  const ref = useRef<HTMLIFrameElement>(null);
  const client = getEngine();

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source === iframe.contentWindow && typeof e.data === 'string') {
        client.handleMessage(e.data);
      }
    };
    window.addEventListener('message', onMessage);
    client.attachPoster((json) => iframe.contentWindow?.postMessage(json, '*'));
    return () => {
      window.removeEventListener('message', onMessage);
      client.detachPoster();
    };
  }, [client]);

  return (
    <iframe
      ref={ref}
      srcDoc={ENGINE_HTML}
      title="gnubg-engine"
      aria-hidden
      style={{ position: 'absolute', width: 0, height: 0, border: 0, opacity: 0 }}
    />
  );
}
