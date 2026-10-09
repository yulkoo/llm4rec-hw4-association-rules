// Every slider position (20 support x 19 confidence): itemset and rule counts from the page's functions,
// plus an exact-integer check of both threshold comparisons. -> analysis/js_slider_grid.json
const fs = require('fs'); const path = require('path');
const app = require('./harness').load('app'); const T = app.TRANSACTIONS; const N = T.length;
const grid = []; let boundaryMismatch = 0; let confMismatch = 0;
for (let s2 = 1; s2 <= 20; s2 += 1) {            // support in half-percent steps: s2/2 %
  const minSupport = Number((s2 / 2).toString()) / 100;   // exactly what readThresholds() does with the slider string
  for (let c = 0; c <= N; c += 1) if ((c / N >= minSupport) !== (c * 200 >= s2 * N)) boundaryMismatch += 1;
  const itemsets = app.findFrequentItemsets(T, minSupport);
  const all = app.generateRules(itemsets, 1e-12);
  for (let cp = 10; cp <= 100; cp += 5) {
    const minConfidence = Number(String(cp)) / 100;
    const rules = app.generateRules(itemsets, minConfidence);
    const exact = all.filter((r) => r.jointCount * 100 >= cp * r.antecedentCount).length;
    if (exact !== rules.length) confMismatch += 1;
    grid.push({ s: s2 / 2, c: cp, itemsets: itemsets.length, rules: rules.length, liftLE1: rules.filter((r) => r.lift <= 1).length });
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'analysis', 'js_slider_grid.json'), JSON.stringify(grid));
console.log(`positions ${grid.length} | support-boundary mismatches vs exact integers: ${boundaryMismatch} | confidence-boundary mismatches: ${confMismatch}`);
console.log('positions with any lift<=1 rule:', grid.filter((g) => g.liftLE1).map((g) => `${g.s}%/${g.c}%:${g.liftLE1}`).join(' ') || 'none');
