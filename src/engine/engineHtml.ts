// The gnubg WASM engine runs inside a hidden WebView used purely as a compute
// sandbox (React Native has no WebAssembly). This HTML mirrors the web app's
// engine worker, but posts raw output lines + RPC responses to the native side
// over the react-native-webview bridge; the native client interprets lines into
// typed engine events (board/resign/line) using the shared parser.
//
// baseUrl is set to ENGINE_ORIGIN when loading this HTML, so the engine's
// relative asset paths ("/engine/gnubg.js", ".wasm", ".data") resolve to the
// deployed origin exactly like they do in the browser.

export const ENGINE_ORIGIN = 'https://bg.skeptrune.com';

export const ENGINE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script>
(function () {
  // Works over two transports: the react-native-webview bridge (native) and
  // window.postMessage to/from a parent frame (web iframe host).
  function post(msg) {
    var s = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage(s, '*');
  }

  var g = window;
  var outBuf = [];
  var started = false;
  var NOISE = [
    'falling back to ArrayBuffer instantiation',
    'wasm streaming compile failed',
    'file packager has copied file data into memory',
  ];

  function onLine(str) {
    for (var i = 0; i < NOISE.length; i++) {
      if (str.indexOf(NOISE[i]) === 0) return;
    }
    outBuf.push(str);
    post({ t: 'line', text: str });
  }

  // stdin feeds a single "y\\n" so gnubg's confirmation prompts auto-accept.
  var stdinPending = '';
  var stdinIdx = 0;
  function stdinFn() {
    if (stdinIdx >= stdinPending.length) {
      if (stdinPending === '') { stdinPending = 'y\\n'; stdinIdx = 0; }
      else { stdinPending = ''; stdinIdx = 0; return null; }
    }
    return stdinPending.charCodeAt(stdinIdx++);
  }

  var cmdBuf = 0;
  function writeCommand(text) {
    var M = g.Module;
    if (!cmdBuf) cmdBuf = M._malloc(4096);
    var n = Math.min(text.length, 4095);
    for (var i = 0; i < n; i++) M.setValue(cmdBuf + i, text.charCodeAt(i) & 0x7f, 'i8');
    M.setValue(cmdBuf + n, 0, 'i8');
  }
  function runCommand(text) { outBuf = []; writeCommand(text); g.Module._run_command(cmdBuf); return outBuf; }
  function nextTurn() { outBuf = []; g.Module._doNextTurn(); return outBuf; }

  var INIT_COMMANDS = [
    'set confirm new off',
    'set confirm save off',
    'set output mwc off',
    'set automatic game on',
  ];

  g.Module = {
    print: onLine,
    printErr: onLine,
    locateFile: function (path) { return '/engine/' + path; },
    preRun: [function () { g.FS.init(stdinFn, null, null); }],
    onRuntimeInitialized: function () {
      g.Module._start();
      for (var i = 0; i < INIT_COMMANDS.length; i++) runCommand(INIT_COMMANDS[i]);
      started = true;
      post({ t: 'ready' });
      flushQueue();
    },
  };

  var queue = [];
  function handle(req) {
    try {
      if (req.cmd.type === 'command') {
        post({ t: 'response', id: req.id, ok: true, lines: runCommand(req.cmd.text) });
      } else if (req.cmd.type === 'nextTurn') {
        post({ t: 'response', id: req.id, ok: true, lines: nextTurn() });
      } else if (req.cmd.type === 'writeFile') {
        g.FS.writeFile(req.cmd.path, req.cmd.contents);
        post({ t: 'response', id: req.id, ok: true });
      } else {
        var file = g.FS.readFile(req.cmd.path, { encoding: 'utf8' });
        post({ t: 'response', id: req.id, ok: true, file: file });
      }
    } catch (e) {
      post({ t: 'response', id: req.id, ok: false, error: String(e) });
    }
  }
  function flushQueue() { while (queue.length > 0) handle(queue.shift()); }

  // Native → engine entry point (called via injectJavaScript on RN).
  window.__recv = function (json) {
    var req = JSON.parse(json);
    if (!started) { queue.push(req); return; }
    handle(req);
  };

  // Web iframe transport: the host posts request JSON to this frame.
  window.addEventListener('message', function (e) {
    if (typeof e.data !== 'string' || e.data.charAt(0) !== '{') return;
    try {
      var d = JSON.parse(e.data);
      if (d && typeof d.id === 'number' && d.cmd) window.__recv(e.data);
    } catch (_) {}
  });

  fetch('/engine/gnubg.js')
    .then(function (r) { if (!r.ok) throw new Error('engine fetch failed: ' + r.status); return r.text(); })
    .then(function (src) { (0, eval)(src); })
    .catch(function (e) { post({ t: 'crashed', error: String(e) }); });
})();
</script>
</body>
</html>`;
