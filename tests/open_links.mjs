// Opens each DOI link of the report in real (headless) Chrome and prints the final URL and page title.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const links = process.argv.slice(2);
const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9335', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'hw4-links-')),
  '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch('http://127.0.0.1:9335/json')).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {}; let status = null;
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  if (m.method === 'Network.responseReceived' && m.params.type === 'Document') status = m.params.response.status; };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
await send('Page.enable'); await send('Network.enable');
for (const url of links) {
  status = null; await send('Page.navigate', { url }); await sleep(9000);
  console.log(`${status} | ${url}\n      -> ${await ev('location.href')}\n      title: ${(await ev('document.title') || '').slice(0, 110)}`);
}
ws.close(); proc.kill();
