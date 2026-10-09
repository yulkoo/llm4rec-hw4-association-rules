// Baseline comparison for the count step at 1% support: the 238,395 candidate pairs counted
// (a) with the provided Set-based index via countPair, (b) inside findFrequentItemsets (sorted id lists).
// Usage: node tests/timing.js
const app = require('./harness').load('app');
const T = app.TRANSACTIONS; const index = app.buildIndex(T);
const time = (fn) => { const t0 = process.hrtime.bigint(); const r = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, r]; };
for (let rep = 0; rep < 3; rep += 1) {
  const [full, itemsets] = time(() => app.findFrequentItemsets(T, 0.01));
  const singles = itemsets.filter((s) => s.items.length === 1).map((s) => s.items[0]);
  const [naive, frequent] = time(() => { let f = 0; for (let i = 0; i < singles.length; i += 1) for (let j = i + 1; j < singles.length; j += 1) if (app.countPair(index, singles[i], singles[j]) / T.length >= 0.01) f += 1; return f; });
  // Horizontal scan, one pass: for every basket, bump a counter for each pair of its frequent items.
  const [scan, viaScan] = time(() => { const keep = new Set(singles); const c = new Map();
    for (const b of T) { const it = b.map((x) => x.stock).filter((x) => keep.has(x)).sort(); for (let i = 0; i < it.length; i += 1) for (let j = i + 1; j < it.length; j += 1) { const k = it[i] + '|' + it[j]; c.set(k, (c.get(k) || 0) + 1); } }
    let f = 0; for (const v of c.values()) if (v / T.length >= 0.01) f += 1; return f; });
  const [rules, r] = time(() => app.generateRules(itemsets, 0.3));
  console.log(`run ${rep + 1}: findFrequentItemsets (all levels) ${full.toFixed(0)} ms -> ${itemsets.length} itemsets | pairs only via countPair ${naive.toFixed(0)} ms (${frequent} frequent) | pairs only via one horizontal scan ${scan.toFixed(0)} ms (${viaScan} frequent) | generateRules ${rules.toFixed(1)} ms -> ${r.length} rules`);
}
