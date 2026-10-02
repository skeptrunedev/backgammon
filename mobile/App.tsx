import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
} from 'react-native-webview/lib/WebViewTypes';
import BundleServer from './modules/bundle-server';
import { handleHostMessage } from './src/hostMessages';

// The whole app is the Backgammon PWA (repo root, built with
// `vite build --mode native` by scripts/build-web.sh), bundled into the binary
// and served by an in-app loopback HTTP server. This file is only the frame:
// a full-screen WebView plus the few things a browser tab can't do itself.

const BACKGROUND = '#1a1512'; // the PWA's theme/background colour

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar hidden />
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const [origin, setOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const webView = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const insets = useSafeAreaInsets();

  // Start the bundle server, and re-check it whenever the app comes back to the
  // foreground (iOS may reclaim the listening socket while suspended).
  const ensureServer = useCallback(() => {
    BundleServer.start().then(
      (o) => {
        setError(null);
        setOrigin((prev) => (prev === o ? prev : o));
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    ensureServer();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') ensureServer();
    });
    return () => sub.remove();
  }, [ensureServer]);

  // Android back: walk the PWA's history (e.g. Play → Home); at the root, let
  // the system handle it (backgrounds the app).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      webView.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const onNavigationStateChange = (nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
  };

  // Only the bundled app loads inside the WebView; any other top-level
  // navigation (lesson videos, mailto:) opens in the system.
  const onShouldStartLoadWithRequest = (req: ShouldStartLoadRequest) => {
    if (!origin) return false;
    if (req.isTopFrame === false) return true;
    if (req.url === origin || req.url.startsWith(origin + '/') || req.url.startsWith('about:')) {
      return true;
    }
    void Linking.openURL(req.url).catch(() => undefined);
    return false;
  };

  const onMessage = (e: WebViewMessageEvent) => {
    void handleHostMessage(e.nativeEvent.data);
  };

  if (error) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.errorTitle}>Backgammon couldn’t start</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={ensureServer} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // iOS: WKWebView feeds the notch/home-indicator insets to the PWA's
  // env(safe-area-inset-*) (viewport-fit=cover), exactly like Safari, so the
  // web view runs edge to edge. Android WebView doesn't reliably expose display
  // cutouts to CSS, so the frame keeps the page clear of them instead.
  const frameInsets =
    Platform.OS === 'android'
      ? { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }
      : null;

  return (
    <View style={[styles.root, frameInsets]}>
      {origin && (
        <WebView
          ref={webView}
          source={{ uri: origin + '/' }}
          style={styles.web}
          containerStyle={styles.web}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onOpenWindow={(e) => void Linking.openURL(e.nativeEvent.targetUrl).catch(() => undefined)}
          onNavigationStateChange={onNavigationStateChange}
          onMessage={onMessage}
          // A crashed/killed web content process leaves a blank view: reload.
          onContentProcessDidTerminate={() => webView.current?.reload()}
          onRenderProcessGone={() => webView.current?.reload()}
          javaScriptEnabled
          domStorageEnabled
          // App, not a web page: no rubber-banding, zoom or OS text scaling
          // (the board is laid out to the viewport).
          bounces={false}
          overScrollMode="never"
          textZoom={100}
          setBuiltInZoomControls={false}
          allowsBackForwardNavigationGestures={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          keyboardDisplayRequiresUserAction={false}
          allowsLinkPreview={false}
          setSupportMultipleWindows
          webviewDebuggingEnabled={__DEV__}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BACKGROUND },
  web: { flex: 1, backgroundColor: BACKGROUND },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorTitle: { color: '#e7dcc1', fontSize: 18, fontWeight: '600' },
  errorText: { color: '#a89c80', fontSize: 14, textAlign: 'center' },
  button: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#c8a24a' },
  buttonText: { color: '#20242b', fontWeight: '700' },
});
