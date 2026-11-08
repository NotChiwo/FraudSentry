// Drives the FraudSentry page inside the Android app's WebView over the
// Chrome DevTools protocol (Node 22's built-in WebSocket): accept the privacy
// notice and expect the app to open straight to Home (no sign-in).
// The WebView's debugging socket is listed a moment before it accepts a
// connection, and it can drop once just after start-up (the page reloading),
// with the app already loaded. So a connection that fails or drops before the
// check is done is retried, and the check (safe to repeat) runs again.
let ws;
let id = 0; const pending = new Map();
const onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const helpers = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(250); } throw new Error('timed out'); };
  const fill = (label, v) => { const el = [...document.querySelectorAll('label')].find(l => l.textContent.trim() === label)?.control
      ?? document.getElementById([...document.querySelectorAll('label')].find(l => l.textContent.trim() === label)?.htmlFor);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const button = re => [...document.querySelectorAll('button')].find(b => re.test(b.textContent));`;
const check = async () => {
  try {
    const env = await run(`${helpers} await until(() => document.querySelector('h1')); return { h1: document.querySelector('h1').textContent, secure: isSecureContext, subtle: typeof crypto.subtle, ua: navigator.userAgent };`);
    console.log('page:', JSON.stringify(env));
    if (!env.secure) throw new Error('not a secure context');
    const out = await run(`${helpers}
      const box = document.querySelector('input[type=checkbox]');
      if (box) { box.click(); await sleep(200); button(/continue to fraudsentry/i).click(); }
      await until(() => document.querySelector('.app-topbar'));
      return { home: !!document.querySelector('.app-topbar'), login: !!document.querySelector('input[type=password]') };`);
    console.log('after the notice:', JSON.stringify(out));
    if (!out.home || out.login) throw new Error('the app did not open to Home');
    ws.onclose = null; ws.close(); process.exit(0);
  } catch (e) {
    if (/connection lost/.test(e.message)) return;   // retry() reconnects and runs the check again
    console.error('smoke check failed:', e.message); process.exit(1);
  }
};
let attempt = 0, retrying = false;
function retry(why) {
  if (retrying) return;
  if (++attempt >= 6) { console.error('websocket error:', why); process.exit(1); }
  retrying = true;
  console.log(`websocket ${why} (attempt ${attempt}), retrying`);
  for (const r of pending.values()) r({ result: { exceptionDetails: 'connection lost' } });
  pending.clear();
  setTimeout(() => { retrying = false; connect(); }, 2000);
}
function connect() {
  const sock = new WebSocket(process.argv[2]);
  ws = sock;
  sock.onmessage = onmessage;
  sock.onopen = () => { void check(); };
  sock.onerror = e => { if (ws === sock) retry(`error ${e.message ?? ''}`.trim()); };
  sock.onclose = () => { if (ws === sock) retry('closed'); };
}
connect();
