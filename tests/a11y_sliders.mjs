// What a screen reader gets for the two sliders, read from Chrome's accessibility tree.
// Usage: node tests/a11y_sliders.mjs [app|starter_original]
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const dir = process.argv[2] || 'app';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9338', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'hw4-a11y-')), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch('http://127.0.0.1:9338/json')).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {};
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
await send('Page.enable'); await send('DOM.enable'); await send('Accessibility.enable');
await send('Page.navigate', { url: 'file://' + path.join(root, dir, 'index.html') }); await sleep(1500);
const ax = async (selector) => {
  const doc = (await send('DOM.getDocument', { depth: 0 })).result.root.nodeId;
  const nodeId = (await send('DOM.querySelector', { nodeId: doc, selector })).result.nodeId;
  const nodes = (await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })).result.nodes;
  const n = nodes[0]; const prop = (k) => (n.properties || []).find((p) => p.name === k)?.value?.value;
  return { ignored: n.ignored, role: n.role?.value, name: n.name?.value, value: n.value?.value, valuetext: prop('valuetext'), live: prop('live'), ariaValuetextAttr: await ev(`document.querySelector('${selector}').getAttribute('aria-valuetext')`), rawProps: selector.endsWith('-value') ? undefined : (n.properties || []).map((p) => p.name + '=' + JSON.stringify(p.value?.value)).join(' ') };
};
const move = (sel, v) => ev(`(()=>{const a=document.querySelector('${sel}'); a.value='${v}'; a.dispatchEvent(new Event('input')); return a.value;})()`);
console.log(`[${dir}]`);
for (const [slider, out, values] of [['#min-support', '#min-support-value', ['1.5', '2', '6.5']], ['#min-confidence', '#min-confidence-value', ['35', '85']]]) {
  console.log(`${slider} at load :`, JSON.stringify(await ax(slider)));
  const names = new Set([(await ax(slider)).name]);
  for (const v of values) { await move(slider, v); const a = await ax(slider); names.add(a.name); console.log(`  moved to ${v.padEnd(4)}:`, JSON.stringify(a)); }
  console.log(`  distinct accessible names while moving: ${names.size} ${JSON.stringify([...names])}`);
  console.log(`  readout ${out}:`, JSON.stringify(await ax(out)), '| aria-live attr:', await ev(`document.querySelector('${out}').getAttribute('aria-live')`), '| aria-hidden attr:', await ev(`document.querySelector('${out}').getAttribute('aria-hidden')`), '| visible text:', await ev(`document.querySelector('${out}').textContent`));
}
ws.close(); proc.kill();
