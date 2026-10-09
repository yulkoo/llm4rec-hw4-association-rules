// Measures what a user feels after clicking "Run rules": is the "Mining…" status ever painted, how long the
// page is blocked, and where the time goes. Usage: node tests/perf_click.mjs [app|<dir>] [support] [confidence]
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const dir = process.argv[2] || 'app'; const cases = process.argv[3] ? [[process.argv[3], process.argv[4]]] : [['0.5', '10'], ['1', '30']];
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9337', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'hw4-perf-')), '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch('http://127.0.0.1:9337/json')).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {};
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? 'EXCEPTION ' + r.exceptionDetails.exception.description.split('\n')[0] : r.result.value; };
await send('Runtime.enable'); await send('Page.enable');
console.log(`[${dir}]`);
for (const [s, c] of cases) {
  await send('Page.navigate', { url: 'file://' + path.join(root, dir, 'index.html') }); await sleep(1500);
  const r = await ev(`new Promise((resolve) => {
    const status = document.getElementById('status'); const seen = []; const stamps = []; let tClick = 0; let firstRows = 0; let longest = 0; let last = performance.now(); let running = true;
    // What reaches the screen: sample the status text once per painted frame; a long gap between frames = frozen page.
    const frame = (now) => { longest = Math.max(longest, now - last); last = now; const t = status.textContent.slice(0, 40); if (seen[seen.length - 1] !== t) { seen.push(t); stamps.push(Math.round(now - tClick)); } if (!firstRows && document.querySelector('#results tbody tr[data-rule-index]') && tClick && /Rendering|Done/.test(t)) firstRows = Math.round(now - tClick); if (running) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    const a = document.getElementById('min-support'), b = document.getElementById('min-confidence'); a.value = '${s}'; b.value = '${c}';
    a.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('input'));
    setTimeout(() => {
      longest = 0; last = performance.now(); const t0 = performance.now(); tClick = t0;
      document.getElementById('run-rules').click();
      const handler = performance.now() - t0;
      const done = () => { if (!/^Done/.test(status.textContent)) return setTimeout(done, 20);
        void document.body.offsetHeight;                                   // force layout of whatever was rendered
        requestAnimationFrame(() => requestAnimationFrame(() => { const total = performance.now() - t0; running = false;
          setTimeout(() => resolve({ handlerMs: Math.round(handler), clickToPaintedMs: Math.round(total), longestFrozenMs: Math.round(longest), firstRowsPaintedMs: firstRows, statusesPainted: seen.length > 6 ? [...seen.slice(0, 3), '… ' + (seen.length - 5) + ' more …', ...seen.slice(-2)] : seen, paintedAtMs: stamps.length > 8 ? [...stamps.slice(0, 5), '…', ...stamps.slice(-3)] : stamps,
            rows: document.querySelectorAll('#results tbody tr').length, status: status.textContent }), 50); })); };
      done();
    }, 300);
  })`);
  console.log(`${s}% / ${c}%:`, JSON.stringify(r));
}
ws.close(); proc.kill();
