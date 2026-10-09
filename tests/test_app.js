// Unit / regression tests for app/script.js, run against the real transactions.js.
// Usage: node tests/test_app.js
const { load } = require('./harness');
const app = load('app');
const T = app.TRANSACTIONS;
const INDEX = app.buildIndex(T);
let passed = 0; let failed = 0;
const close = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;
function test(name, fn) {
  try { const detail = fn(); passed += 1; console.log(`PASS ${String(passed + failed).padStart(2)}. ${name}${detail ? ' — ' + detail : ''}`); }
  catch (e) { failed += 1; console.log(`FAIL ${String(passed + failed).padStart(2)}. ${name} — ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const key = (items) => [...items].sort().join('|');

// Brute-force reference: enumerate every subset of the item universe (tiny data only).
function bruteItemsets(baskets, minSupport) {
  const sets = baskets.map((b) => new Set(b));
  const universe = [...new Set(baskets.flat())].sort();
  const out = new Map();
  for (let mask = 1; mask < (1 << universe.length); mask += 1) {
    const items = universe.filter((_, i) => mask & (1 << i));
    const count = sets.filter((s) => items.every((x) => s.has(x))).length;
    if (count / baskets.length >= minSupport) out.set(key(items), count);
  }
  return out;
}
function bruteRules(baskets, minSupport, minConfidence) {
  const frequent = bruteItemsets(baskets, minSupport);
  const out = new Map();
  for (const [k, joint] of frequent) {
    const items = k.split('|');
    if (items.length < 2) continue;
    for (let mask = 1; mask < (1 << items.length) - 1; mask += 1) {
      const a = items.filter((_, i) => mask & (1 << i)); const b = items.filter((_, i) => !(mask & (1 << i)));
      const conf = joint / frequent.get(key(a));
      if (conf >= minConfidence) out.set(`${key(a)}>${key(b)}`, { conf, lift: conf / (frequent.get(key(b)) / baskets.length) });
    }
  }
  return out;
}
// Small deterministic PRNG (mulberry32) so the random tests are reproducible.
function prng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const fixture = app.tinyWorkedExample();

test('page self-checks: 11 pass, 0 fail, 0 pending', () => {
  const r = app.runTests(app.document.getElementById('testLog'));
  assert(r.passed === 11 && r.failed === 0 && r.pending === 0, JSON.stringify(r)); return `${r.passed}/11`;
});
test('dedupeBasket: order, mixed strings/objects, empty input', () => {
  const d = app.dedupeBasket(['b', { stock: 'a', description: 'x' }, 'b', { stock: 'a' }, 'c']);
  assert(JSON.stringify(d) === '["b","a","c"]', JSON.stringify(d));
  assert(app.dedupeBasket([]).length === 0); return 'b,a,c';
});
test('countItemset contract: empty request, unknown stock, repeated stock, index or array input', () => {
  assert(app.countItemset(fixture.baskets, []) === 0, 'empty');
  assert(app.countItemset(fixture.baskets, ['bread', 'NOPE']) === 0, 'unknown');
  assert(app.countItemset(fixture.baskets, ['milk', 'milk', 'jam']) === 2, 'repeat');
  assert(app.countItemset(app.buildIndex(fixture.baskets), ['bread', 'milk', 'jam']) === 2, 'index');
});
test('slide 8 example: A∪B=3, A=5, B=5, N=8 -> 37.5%, 60%, lift 0.96', () => {
  const s = app.computeSupport(3, 8); const c = app.computeConfidence(3, 5); const l = app.computeLift(c, 5, 8);
  assert(close(s.value, 0.375) && close(c.value, 0.6) && close(l.value, 0.96), `${s.value} ${c.value} ${l.value}`); return `lift=${l.value}`;
});
test('slide 11 example: confidence 3/5 vs 3/6 differs by direction, lift does not', () => {
  const ab = app.computeConfidence(3, 5); const ba = app.computeConfidence(3, 6);
  assert(close(ab.value, 0.6) && close(ba.value, 0.5));
  assert(close(app.computeLift(ab, 6, 8).value, app.computeLift(ba, 5, 8).value)); return '60% vs 50%';
});
test('zero denominators: defined=false and value 0, never NaN/Infinity', () => {
  for (const m of [app.computeSupport(3, 0), app.computeConfidence(3, 0), app.computeLift({ value: 0.5, defined: true }, 0, 5),
    app.computeLift({ value: 0.5, defined: true }, 2, 0), app.computeLift({ value: 0, defined: false }, 2, 5), app.computeLift(undefined, 2, 5)]) {
    assert(m.defined === false && m.value === 0, JSON.stringify(m));
  }
});
test('fixture itemsets equal brute-force enumeration at 5 thresholds', () => {
  for (const ms of [0.2, 0.4, 0.6, 0.8, 1]) {
    const got = new Map(app.findFrequentItemsets(fixture.baskets, ms).map((s) => [key(s.items), s.count]));
    const want = bruteItemsets(fixture.baskets, ms);
    assert(got.size === want.size && [...want].every(([k, c]) => got.get(k) === c), `minSupport ${ms}: ${got.size} vs ${want.size}`);
  }
  return 'sizes ' + [0.2, 0.4, 0.6, 0.8, 1].map((ms) => app.findFrequentItemsets(fixture.baskets, ms).length).join('/');
});
test('support threshold is inclusive (count 2 of 5 passes minSupport 0.4)', () => {
  const sets = app.findFrequentItemsets(fixture.baskets, 0.4).map((s) => key(s.items));
  assert(sets.includes('eggs') && sets.includes('jam|milk') && !sets.includes('ham'));
});
test('fixture rules equal brute force; hand values for milk->jam and bread->milk', () => {
  const rules = app.generateRules(app.findFrequentItemsets(fixture.baskets, 0.2), 0.5);
  const want = bruteRules(fixture.baskets, 0.2, 0.5);
  assert(rules.length === want.size, `${rules.length} vs ${want.size}`);
  for (const r of rules) { const w = want.get(`${key(r.antecedent)}>${key(r.consequent)}`); assert(w && close(w.conf, r.confidence) && close(w.lift, r.lift)); }
  const find = (a, b) => rules.find((r) => key(r.antecedent) === a && key(r.consequent) === b);
  assert(close(find('milk', 'jam').lift, 10 / 9) && close(find('bread', 'milk').lift, 1)); return `${rules.length} rules`;
});
test('200 random datasets: itemsets and rules equal brute force', () => {
  const rnd = prng(42); let sets = 0; let rules = 0;
  for (let run = 0; run < 200; run += 1) {
    const nItems = 3 + Math.floor(rnd() * 6); const nBaskets = 4 + Math.floor(rnd() * 20);
    const baskets = [];
    for (let b = 0; b < nBaskets; b += 1) {
      const basket = []; for (let i = 0; i < nItems; i += 1) if (rnd() < 0.2 + 0.1 * (i % 4)) basket.push('i' + i);
      if (rnd() < 0.3 && basket.length) basket.push(basket[0]); // duplicated row inside a basket
      baskets.push(basket.length ? basket : ['i0']);
    }
    const ms = [0.1, 0.2, 0.3, 0.5][run % 4]; const mc = [0.2, 0.5, 0.8][run % 3];
    const got = app.findFrequentItemsets(baskets, ms); const want = bruteItemsets(baskets, ms);
    assert(got.length === want.size && got.every((s) => want.get(key(s.items)) === s.count), `run ${run}: itemsets ${got.length} vs ${want.size}`);
    const gr = app.generateRules(got, mc); const wr = bruteRules(baskets, ms, mc);
    assert(gr.length === wr.size && gr.every((r) => { const w = wr.get(`${key(r.antecedent)}>${key(r.consequent)}`); return w && close(w.conf, r.confidence) && close(w.lift, r.lift); }), `run ${run}: rules ${gr.length} vs ${wr.size}`);
    sets += got.length; rules += gr.length;
  }
  return `${sets} itemsets, ${rules} rules compared`;
});
test('real data anchors: 17,080 baskets, 3,653 items, 85123A in 1,959 baskets (11.47%)', () => {
  assert(T.length === 17080 && INDEX.byStock.size === 3653);
  const c = app.countItem(INDEX, '85123A'); assert(c === 1959, String(c));
  assert((c / T.length * 100).toFixed(2) === '11.47');
  assert(app.descriptionByStock.get('85123A') === 'WHITE HANGING HEART T-LIGHT HOLDER');
});

const itemsets = app.findFrequentItemsets(T, 0.01);
const rules = app.generateRules(itemsets, 0.3);
test('real data, 1% support: every itemset meets the threshold and its count equals countItemset', () => {
  for (const s of itemsets) { assert(s.support >= 0.01 && s.count === app.countItemset(INDEX, s.items) && close(s.support, s.count / 17080), key(s.items)); }
  assert(new Set(itemsets.map((s) => key(s.items))).size === itemsets.length, 'duplicate itemset'); return `${itemsets.length} itemsets`;
});
test('real data: downward closure holds (every subset of a frequent itemset is listed, with count >= superset)', () => {
  const byKey = new Map(itemsets.map((s) => [key(s.items), s.count])); let checked = 0;
  for (const s of itemsets) for (let d = 0; s.items.length > 1 && d < s.items.length; d += 1) {
    const sub = s.items.filter((_, i) => i !== d); assert(byKey.get(key(sub)) >= s.count, key(sub)); checked += 1;
  }
  return `${checked} subset checks`;
});
test('real data: no frequent pair is missed (all pairs of frequent items re-counted)', () => {
  const singles = itemsets.filter((s) => s.items.length === 1).map((s) => s.items[0]);
  const listed = new Set(itemsets.filter((s) => s.items.length === 2).map((s) => key(s.items))); let frequentPairs = 0;
  for (let i = 0; i < singles.length; i += 1) for (let j = i + 1; j < singles.length; j += 1) {
    const isFrequent = app.countPair(INDEX, singles[i], singles[j]) / 17080 >= 0.01;
    if (isFrequent) frequentPairs += 1;
    assert(isFrequent === listed.has(key([singles[i], singles[j]])), `${singles[i]},${singles[j]}`);
  }
  return `${frequentPairs} frequent of ${singles.length * (singles.length - 1) / 2} pairs`;
});
test('real data: every rule passes both thresholds and its metrics equal the definitions', () => {
  for (const r of rules) {
    const joint = app.countItemset(INDEX, [...r.antecedent, ...r.consequent]); const a = app.countItemset(INDEX, r.antecedent); const b = app.countItemset(INDEX, r.consequent);
    assert(joint === r.jointCount && a === r.antecedentCount && b === r.consequentCount, 'counts');
    assert(close(r.support, joint / 17080) && close(r.confidence, joint / a) && close(r.lift, (joint / a) / (b / 17080)), 'metrics');
    assert(r.support >= 0.01 && r.confidence >= 0.3, 'threshold');
  }
  return `${rules.length} rules`;
});
test('real data: both directions are generated; lift and support are symmetric, confidence is not', () => {
  const all = app.generateRules(itemsets, 1e-9); const byKey = new Map(all.map((r) => [`${key(r.antecedent)}>${key(r.consequent)}`, r])); let differing = 0;
  for (const r of all) {
    const rev = byKey.get(`${key(r.consequent)}>${key(r.antecedent)}`); assert(rev, 'missing reverse');
    assert(close(rev.lift, r.lift, 1e-9) && rev.support === r.support, 'symmetry');
    if (!close(rev.confidence, r.confidence)) differing += 1;
  }
  return `${all.length} rules, confidence differs in ${differing}`;
});
test('hand-computed rule 22697 -> 22699: 541/691/780 -> 3.1674%, 78.2923%, lift 17.1440', () => {
  const r = rules.find((x) => key(x.antecedent) === '22697' && key(x.consequent) === '22699');
  assert(r && r.jointCount === 541 && r.antecedentCount === 691 && r.consequentCount === 780, JSON.stringify(r));
  assert(app.formatPercent(r.support) === '3.17%' && app.formatPercent(r.confidence) === '78.29%' && app.formatMetric(r.lift) === '17.1440');
  const rev = app.reverseRule(r, INDEX);
  assert(app.formatPercent(rev.confidence) === '69.36%' && app.formatMetric(rev.lift) === '17.1440'); return 'reverse 69.36%, lift 17.1440';
});
test('detail panel: unknown antecedent shows the inline zero-denominator note, no NaN/Infinity', () => {
  const box = app.document.createElement('div');
  app.renderRuleDetail({ antecedent: ['NO-SUCH-CODE'], consequent: ['85123A'] }, INDEX, box);
  assert(/count\(A\) = 0/.test(box.innerHTML) && !/NaN|Infinity/.test(box.innerHTML), box.innerHTML.slice(0, 200));
  app.renderRuleDetail({ antecedent: ['85123A'], consequent: ['NO-SUCH-CODE'] }, INDEX, box);
  assert(/count\(B\) = 0/.test(box.innerHTML) && !/NaN|Infinity/.test(box.innerHTML));
});
test('generateRules tolerates an incomplete itemset list and an empty list', () => {
  assert(app.generateRules([], 0.5).length === 0);
  assert(app.generateRules([{ items: ['a', 'b'], count: 2, support: 0.5 }], 0.1).length === 0);
});
test('thresholds are monotone: raising either one never adds itemsets or rules', () => {
  let prevSets = Infinity; const counts = [];
  for (const ms of [0.01, 0.02, 0.03, 0.05]) {
    const s = app.findFrequentItemsets(T, ms); assert(s.length <= prevSets); prevSets = s.length; let prevRules = Infinity;
    for (const mc of [0.1, 0.3, 0.6]) { const n = app.generateRules(s, mc).length; assert(n <= prevRules); prevRules = n; }
    counts.push(s.length);
  }
  return counts.join(' >= ');
});
// --- regression tests for defects found in the provided (starter) code ---
test('starter defect: undefined metrics are shown as "undefined", not as 0.00% / 0.0000 (detail, reverse line, table row)', () => {
  const box = app.document.createElement('div');
  app.renderRuleDetail({ antecedent: ['NO-SUCH-CODE'], consequent: ['85123A'] }, INDEX, box);
  const cell = (label) => (box.innerHTML.match(new RegExp(`<dt>${label}</dt><dd class="num">([^<]*)</dd>`)) || [])[1];
  assert(cell('confidence') === 'undefined' && cell('lift') === 'undefined' && cell('support') === '0.00%', `${cell('support')} ${cell('confidence')} ${cell('lift')}`);
  assert(/confidence\(A → B\) and lift are undefined/.test(box.innerHTML), 'note for count(A)=0');
  app.renderRuleDetail({ antecedent: ['85123A'], consequent: ['NO-SUCH-CODE'] }, INDEX, box);
  assert(cell('confidence') === '0.00%' && cell('lift') === 'undefined', `${cell('confidence')} ${cell('lift')}`);
  const strong = [...box.innerHTML.matchAll(/<strong>([^<]*)<\/strong>/g)].map((m) => m[1]);
  assert(strong[0] === 'undefined' && strong[1] === 'undefined', 'reverse line: ' + strong.join(','));
  app.renderResults([{ antecedent: ['NO-SUCH-CODE'], consequent: ['85123A'] }], INDEX, box);
  assert((box.innerHTML.match(/<td class="num">undefined<\/td>/g) || []).length === 2, 'table row');
  return 'confidence/lift undefined, support 0.00%';
});
test('starter defect: a defined rule is rendered exactly as before (no "undefined" anywhere)', () => {
  const box = app.document.createElement('div'); const r = rules.find((x) => key(x.antecedent) === '22697' && key(x.consequent) === '22699');
  app.renderRuleDetail(r, INDEX, box);
  assert(!/undefined/.test(box.innerHTML) && /78\.29%/.test(box.innerHTML) && /69\.36%/.test(box.innerHTML) && /17\.1440/.test(box.innerHTML));
  app.renderResults(rules, INDEX, box); assert(!/undefined/.test(box.innerHTML) && (box.innerHTML.match(/<tr tabindex/g) || []).length === 950);
});
test('starter defect: a new run clears the "Selected rule" panel instead of leaving a stale rule', () => {
  const panel = app.document.getElementById('rule-detail');
  app.renderRuleDetail(rules[0], INDEX, panel); assert(/HERB MARKER/.test(panel.innerHTML), 'precondition');
  app.document.getElementById('min-support').value = '3'; app.document.getElementById('min-confidence').value = '60';
  app.runPipeline();
  assert(/Click a rule row to inspect it/.test(panel.innerHTML) && !/HERB MARKER/.test(panel.innerHTML), panel.innerHTML.slice(0, 80));
  assert(/Done — 5 rule\(s\)/.test(app.document.getElementById('status').textContent)); return '5 rules, panel reset';
});
test('starter defect: rule tables sit in a horizontal scroll container; provenance correction is shown', () => {
  const box = app.document.createElement('div'); app.renderResults(rules.slice(0, 2), INDEX, box);
  assert(/<div style="overflow-x: auto">\s*<table class="data-table rules-table">/.test(box.innerHTML));
  app.renderDatasetSummary(INDEX, box); assert(/Sai Laing Sain/.test(box.innerHTML) && /132,219/.test(box.innerHTML) && /Sai Liang Sain/.test(box.innerHTML));
});
test('freeze fix: level 2 counted by one pass over the baskets equals pair-by-pair counting (0.5% support: 2,206 pairs of 870,540)', () => {
  const sets = app.findFrequentItemsets(T, 0.005); const singles = sets.filter((x) => x.items.length === 1); const pairs = sets.filter((x) => x.items.length === 2);
  assert(singles.length === 1320 && pairs.length === 2206, `${singles.length} / ${pairs.length}`);
  for (const p of pairs) assert(p.count === app.countPair(INDEX, p.items[0], p.items[1]) && p.count / 17080 >= 0.005, key(p.items));
  // and none is missed: a sample of 60,000 pairs of frequent items, re-counted through the Set index
  const rnd = prng(7); const listed = new Set(pairs.map((p) => key(p.items))); let checked = 0;
  for (let t = 0; t < 60000; t += 1) { const i = Math.floor(rnd() * singles.length); const j = Math.floor(rnd() * singles.length); if (i === j) continue;
    const a = singles[i].items[0]; const b = singles[j].items[0]; checked += 1;
    assert((app.countPair(INDEX, a, b) / 17080 >= 0.005) === listed.has(key([a, b])), `${a},${b}`); }
  return `${pairs.length} pairs equal; ${checked} sampled pairs agree`;
});
test('freeze fix: runPipeline reports progress, ends with "Done" and re-enables the button', () => {
  const button = app.document.getElementById('run-rules'); button.disabled = false;
  app.document.getElementById('min-support').value = '1'; app.document.getElementById('min-confidence').value = '30';
  app.runPipeline();
  assert(/^Done — 950 rule\(s\)/.test(app.document.getElementById('status').textContent), app.document.getElementById('status').textContent);
  assert(button.disabled === false, 'button still disabled');
  const calls = []; app.renderResults(rules.slice(0, 3), INDEX, app.document.createElement('div'), (done, total) => calls.push(`${done}/${total}`));
  assert(calls.join() === '3/3', calls.join()); calls.length = 0;
  app.renderResults([], INDEX, app.document.createElement('div'), (done, total) => calls.push(`${done}/${total}`)); assert(calls.join() === '0/0');
});
test('starter defect (accessibility): slider readout is not a live region; the slider carries the value as aria-valuetext', () => {
  const sup = app.document.getElementById('min-support'); const conf = app.document.getElementById('min-confidence');
  const supOut = app.document.getElementById('min-support-value'); const confOut = app.document.getElementById('min-confidence-value');
  sup.value = '6.5'; conf.value = '85'; app.syncThresholdLabels();
  assert(sup.getAttribute('aria-valuetext') === '6.5%' && conf.getAttribute('aria-valuetext') === '85%', `${sup.getAttribute('aria-valuetext')} ${conf.getAttribute('aria-valuetext')}`);
  for (const out of [supOut, confOut]) assert(out.getAttribute('aria-live') === 'off' && out.getAttribute('aria-hidden') === 'true', 'readout attributes');
  assert(supOut.textContent === '6.5%' && confOut.textContent === '85%', 'visible text unchanged'); return '6.5% / 85%';
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
