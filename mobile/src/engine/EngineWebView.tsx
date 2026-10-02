import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { ENGINE_HTML, ENGINE_ORIGIN } from './engineHtml';
import { getEngine } from './nativeClient';

/**
 * Mounts the gnubg WASM engine inside an invisible WebView (the only way to run
 * WebAssembly under React Native) and wires it to the shared GnubgClient. Render
 * this once, near the app root. The UI never sees it — it's a compute sandbox.
 */
export function EngineWebView() {
  const ref = useRef<WebView>(null);
  const client = getEngine();

  useEffect(() => {
    return () => client.detachPoster();
  }, [client]);

  const onMessage = (e: WebViewMessageEvent) => {
    client.handleMessage(e.nativeEvent.data);
  };

  const onLoadEnd = () => {
    client.attachPoster((json) => {
      // JSON.stringify(json) safely embeds the request as a JS string literal.
      ref.current?.injectJavaScript(`window.__recv(${JSON.stringify(json)}); true;`);
    });
  };

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, top: -10, left: -10 }}
    >
      <WebView
        ref={ref}
        source={{ html: ENGINE_HTML, baseUrl: ENGINE_ORIGIN }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        onError={(e) =>
          client.handleMessage(
            JSON.stringify({ t: 'crashed', error: `webview error: ${e.nativeEvent.description}` }),
          )
        }
        // Keep it alive/running in the background of the app.
        androidLayerType="hardware"
      />
    </View>
  );
}
