// Headless-Chrome check of the real page (opened from file://) over the DevTools protocol.
// Usage: node tests/browser_check.mjs [app|starter_original]
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const dir = process.argv[2] || 'app';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'hw4-chrome-')), '--window-size=1280,1400', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch('http://127.0.0.1:9334/json')).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {}; const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') logs.push(JSON.stringify(m.params).slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).innerText.replace(/\\n+/g, ' | ')`);
const setSliders = (s, c) => ev(`(()=>{const a=document.getElementById('min-support'), b=document.getElementById('min-confidence'); a.value='${s}'; b.value='${c}'; a.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('input')); return a.value+'/'+b.value;})()`);
// Runs are asynchronous since the freeze fix: click, then wait until the status says Done (or reports a failure).
const run = async () => { const t0 = Date.now(); await ev("document.getElementById('run-rules').click()");
  for (let i = 0; i < 600; i++) { const st = await ev("document.getElementById('status').textContent"); if (/^Done|not implemented|must be/.test(st)) break; await sleep(25); }
  return Date.now() - t0; };

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
const url = 'file://' + path.join(root, dir, 'index.html');
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) { if ((await ev("document.getElementById('status') && document.getElementById('status').textContent || ''")).startsWith('Dataset ready')) break; await sleep(100); }
console.log(`[${dir}] opened ${url.replace(root, '.')}`);
console.log('summary:', await text('#dataset-summary-body .summary-line'));
console.log('status :', await text('#status'));
await ev("document.getElementById('run-tests').click()"); await sleep(100);
console.log('tests  :', (await ev("document.getElementById('testLog').textContent")).split('\n')[0]);

console.log('sliders', await setSliders(1, 30), '-> click took', await run(), 'ms');
console.log('status :', await text('#status'));
console.log('rows   :', await ev("document.querySelectorAll('#results tbody tr').length"), '|', await text('#results .results-count'));
if (await ev("document.querySelectorAll('#results tbody tr').length") > 0) {
  console.log('row 1  :', await text('#results tbody tr'));
  console.log('lift<=1 rows in table:', await ev("[...document.querySelectorAll('#results tbody tr')].filter(r=>Number(r.cells[7].textContent)<=1).length"));
  // Click the tea-cup rule (22697 -> 22699), then reverse it.
  await ev(`[...document.querySelectorAll('#results tbody tr')].find(r=>/^22697 — [^,]*$/.test(r.cells[0].textContent)&&/^22699 — [^,]*$/.test(r.cells[1].textContent)).click()`);
  console.log('detail :', await text('#rule-detail'));
  await ev("window.scrollTo(0, document.querySelector('.layout').offsetTop - 8)"); await sleep(150);
  await ev("document.getElementById('reverse-rule').click()");
  console.log('reverse:', await text('#rule-detail'));
  // The rule the report rejects needs the lowest slider positions.
  console.log('sliders', await setSliders(0.5, 10), '-> click took', await run(), 'ms |', await text('#status'));
  await ev(`[...document.querySelectorAll('#results tbody tr')].find(r=>/^22727 — [^,]*$/.test(r.cells[0].textContent)&&/^85123A — [^,]*$/.test(r.cells[1].textContent)).click()`);
  console.log('reject :', await text('#rule-detail'));
  console.log('lift<=1 rows in table:', await ev("[...document.querySelectorAll('#results tbody tr')].filter(r=>Number(r.cells[7].textContent)<=1).length"));
  console.log('sliders', await setSliders(3, 60), '-> click took', await run(), 'ms |', await text('#status'));
  await ev(`[...document.querySelectorAll('#results tbody tr')].find(r=>/^22697 — [^,]*$/.test(r.cells[0].textContent)&&/^22699 — [^,]*$/.test(r.cells[1].textContent)).click()`);
  await ev("document.getElementById('run-tests').click(); window.scrollTo(0, document.querySelector('.layout').offsetTop - 8)"); await sleep(150);
  console.log('3%/60% table:', await text('#results tbody'));
  if (dir === 'app') await shot(path.join(root, 'report/fig/app_rules.png'));
  console.log('sliders', await setSliders(10, 100), '-> click took', await run(), 'ms |', await text('#status'), '|', await text('#results'));
} else {
  console.log('results:', await text('#results'));
}
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 2, mobile: true }); await sleep(200);
console.log('mobile horizontal overflow:', await ev('document.documentElement.scrollWidth > window.innerWidth'));
console.log('console messages/errors:', logs.length ? logs : 'none');
ws.close(); proc.kill();
