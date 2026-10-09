// Dumps what the page's own functions return, for the cross-checks and the report tables.
// Usage: node tests/export_results.js   -> analysis/js_results.json
const fs = require('fs');
const path = require('path');
const app = require('./harness').load('app');
const T = app.TRANSACTIONS;

const supports = [0.005, 0.01, 0.015, 0.02, 0.03, 0.05];
const confidences = [0.1, 0.3, 0.5, 0.6, 0.8];
const out = { n: T.length, sweep: [], settings: {} };

for (const minSupport of supports) {
  const t0 = process.hrtime.bigint();
  const itemsets = app.findFrequentItemsets(T, minSupport);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const bySize = {};
  itemsets.forEach((s) => { bySize[s.items.length] = (bySize[s.items.length] || 0) + 1; });
  for (const minConfidence of confidences) {
    const rules = app.generateRules(itemsets, minConfidence);
    out.sweep.push({
      minSupport, minConfidence, itemsets: itemsets.length, bySize, mineMs: Math.round(ms),
      rules: rules.length, liftAbove1: rules.filter((r) => r.lift > 1).length,
      minLift: rules.length ? Math.min(...rules.map((r) => r.lift)) : null,
    });
    const key = `${minSupport}|${minConfidence}`;
    if (['0.01|0.3', '0.03|0.6', '0.01|0.1', '0.005|0.1'].includes(key)) {
      out.settings[key] = {
        itemsets: itemsets.map((s) => ({ items: [...s.items].sort(), count: s.count })),
        rules: rules.map((r) => ({ a: r.antecedent, b: r.consequent, joint: r.jointCount, ca: r.antecedentCount, cb: r.consequentCount, support: r.support, confidence: r.confidence, lift: r.lift })),
      };
    }
  }
}
out.descriptions = Object.fromEntries(app.descriptionByStock);
fs.writeFileSync(path.join(__dirname, '..', 'analysis', 'js_results.json'), JSON.stringify(out));
console.log('minSup  minConf  itemsets (by size)                          rules  lift>1  min lift  mine ms');
for (const r of out.sweep) {
  console.log(`${(r.minSupport * 100).toFixed(1).padStart(5)}%  ${(r.minConfidence * 100).toFixed(0).padStart(5)}%  ${String(r.itemsets).padStart(5)} ${JSON.stringify(r.bySize).padEnd(44)} ${String(r.rules).padStart(6)} ${String(r.liftAbove1).padStart(6)}  ${r.minLift === null ? '    -' : r.minLift.toFixed(3).padStart(7)}  ${String(r.mineMs).padStart(6)}`);
}
