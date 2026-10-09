/**
 * week4/script.js — Association-rule mining starter (HW4).
 *
 * This is a plain (classic) script, NOT an ES module. `week4/transactions.js`
 * (loaded first, in a regular <script> tag) assigns the dictionary-encoded UCI
 * Online Retail baskets to `window.HW4`. This file reads that global, decodes
 * the integer-index baskets back into `{ stock, description }` items, renders a
 * dataset summary, and wires two slider controls ("minimum support" and
 * "minimum confidence") plus a "Run rules" button. Because nothing is fetched,
 * the page works from a `file://` URL with no server.
 *
 * IMPLEMENTED FOR HW4 (the seven former `TODO(hw4)` stubs):
 *   1. `dedupeBasket`         — unique stock codes in a basket, first-appearance order.
 *   2. `countItemset`         — baskets containing every requested stock (`0` if any is absent).
 *   3. `computeSupport`       — support = count(A union B) / N, guarded when N = 0.
 *   4. `computeConfidence`    — confidence = count(A union B) / count(A), guarded when count(A) = 0.
 *   5. `computeLift`          — lift = confidence / (count(B) / N), guarded.
 *   6. `findFrequentItemsets` — mine frequent itemsets (Apriori or equivalent).
 *   7. `generateRules`        — turn frequent itemsets into both-direction rules.
 *
 * PROVIDED for you (scaffolding): dataset loading/decoding from `window.HW4`, the
 * inverted-index builder (`buildIndex` / `asIndex` / `indexCache`), the thin
 * counting wrappers `countItem` / `countPair` (they call your `countItemset` and
 * therefore also throw until it is implemented), threshold validation and slider
 * readout, the DOM wiring, all formatting and rendering helpers, and the test
 * harness. Leave the provided code as-is and implement only the stubs above.
 *
 * Metrics (see week4/readme.md for definitions):
 *   support(A -> B)    = count(A union B) / N
 *   confidence(A -> B) = count(A union B) / count(A)
 *   lift(A -> B)       = confidence(A -> B) / (count(B) / N)
 *
 * @module week4/script
 */

// Defensive guard: `transactions.js` must run before this file. If `window.HW4`
// is missing (for example because `transactions.js` was not copied next to
// `index.html`), fail loudly and visibly instead of throwing an opaque error.
if (typeof window === "undefined" || typeof window.HW4 === "undefined") {
  if (typeof document !== "undefined") {
    document.body.innerHTML =
      '<p style="padding:2rem;font-family:sans-serif">' +
      "Failed to load `transactions.js`. Make sure it sits next to `index.html` " +
      "and is loaded before `script.js`.</p>";
  }
  throw new Error(
    "window.HW4 is not defined — load transactions.js before script.js.",
  );
}

/** The raw dataset global assigned by `week4/transactions.js`. */
const data = window.HW4;

/**
 * Baskets decoded from the dictionary-encoded arrays in `window.HW4`. Each
 * basket is an array of `{ stock, description }` items, matching the fixture
 * shape used by the tests.
 *
 * @type {Array<Array<Item>>}
 */
const TRANSACTIONS = data.baskets.map((basket) =>
  basket.map((stockIndex) => ({
    stock: data.stocks[stockIndex],
    description: data.descriptions[stockIndex],
  })),
);

/**
 * Dataset-wide inverted index, built once at startup. `null` until `init()` has
 * run, so the UI can tell "still loading" from "loaded".
 *
 * @type {BasketIndex|null}
 */
let DATASET_INDEX = null;

/** Number of baskets (the `N` used by support and lift). */
let N = data.N_BASKETS;

/**
 * @typedef {Object} Item
 * @property {string} stock       Stock code (the item identity).
 * @property {string} description Human-readable product description.
 */

/**
 * @typedef {Object} Rule
 * @property {string[]} antecedent    Item identities on the left-hand side (A).
 * @property {string[]} consequent    Item identities on the right-hand side (B).
 * @property {number} jointCount      count(A union B).
 * @property {number} antecedentCount count(A).
 * @property {number} consequentCount count(B).
 * @property {number} support         jointCount / N.
 * @property {number} confidence      jointCount / antecedentCount.
 * @property {number} lift            confidence / (consequentCount / N).
 */

/**
 * @typedef {Object} BasketIndex
 * @property {number} n                              Number of baskets.
 * @property {Map<string, Set<number>>} byStock      Stock code -> basket ids.
 */

// ---------------------------------------------------------------------------
// Provided helpers and student stubs
//
// The seven former `TODO(hw4)` stubs are implemented below; every other
// function in this file is the provided scaffolding.
// ---------------------------------------------------------------------------

/**
 * Read the item identity out of a basket entry. Accepts either a plain string or
 * an object with a `stock` property so the helpers work with both the real
 * dataset and the small fixtures used by the tests.
 *
 * @param {Item|string} item
 * @returns {string}
 */
function stockOf(item) {
  return typeof item === "string" ? item : item.stock;
}

/**
 * Build an inverted index from basket id to the set of baskets containing each
 * stock code. Counting a candidate itemset then becomes a set intersection.
 *
 * @param {Array<Array<Item|string>>} baskets
 * @returns {BasketIndex}
 */
function buildIndex(baskets) {
  /** @type {Map<string, Set<number>>} */
  const byStock = new Map();
  baskets.forEach((basket, basketId) => {
    for (const item of basket) {
      const stock = stockOf(item);
      let posting = byStock.get(stock);
      if (!posting) {
        posting = new Set();
        byStock.set(stock, posting);
      }
      posting.add(basketId);
    }
  });
  return { n: baskets.length, byStock };
}

/** Cache of lazily built indexes, keyed by the baskets array. */
const indexCache = new WeakMap();

/**
 * Accept either a ready-made index or a raw basket array and return an index.
 *
 * @param {BasketIndex|Array<Array<Item|string>>} basketsOrIndex
 * @returns {BasketIndex}
 */
function asIndex(basketsOrIndex) {
  if (basketsOrIndex && !Array.isArray(basketsOrIndex) && basketsOrIndex.byStock) {
    return basketsOrIndex;
  }
  let index = indexCache.get(basketsOrIndex);
  if (!index) {
    index = buildIndex(basketsOrIndex);
    indexCache.set(basketsOrIndex, index);
  }
  return index;
}

/**
 * Count the baskets that contain every stock code in `stocks`.
 *
 * Implemented (HW4): reuse the basket -> stock inverted index, intersect the
 * posting lists of the requested stocks, and return the size of the
 * intersection.
 *
 * Contract:
 *  - Accept either a ready-made index or a raw basket array. The provided
 *    `asIndex` helper returns an index for either input.
 *  - Return `0` when `stocks` is empty, and also when any requested stock is
 *    absent from the dataset (never throw for an unknown stock).
 *  - A stock repeated within one basket must be counted at most once. Dedupe the
 *    request before intersecting.
 *
 * @param {BasketIndex|Array<Array<Item|string>>} basketsOrIndex
 * @param {Array<string|Item>} stocks
 * @returns {number} count(A) for a single-element `stocks`, count(A union B) for two.
 */
function countItemset(basketsOrIndex, stocks) {
  const index = asIndex(basketsOrIndex);
  const wanted = dedupeBasket(stocks || []);
  if (wanted.length === 0) return 0;

  const postings = [];
  for (const stock of wanted) {
    const posting = index.byStock.get(stock);
    if (!posting) return 0;
    postings.push(posting);
  }
  // Walk the shortest posting list and probe the others: the intersection can
  // never be larger than its smallest operand.
  postings.sort((a, b) => a.size - b.size);
  const [smallest, ...others] = postings;
  let count = 0;
  for (const basketId of smallest) {
    if (others.every((posting) => posting.has(basketId))) count += 1;
  }
  return count;
}

/**
 * Count the baskets containing a single stock code.
 *
 * @param {BasketIndex|Array<Array<Item|string>>} basketsOrIndex
 * @param {string|Item} stock
 * @returns {number}
 */
function countItem(basketsOrIndex, stock) {
  return countItemset(basketsOrIndex, [stock]);
}

/**
 * Count the baskets containing both `stockA` and `stockB`.
 *
 * @param {BasketIndex|Array<Array<Item|string>>} basketsOrIndex
 * @param {string|Item} stockA
 * @param {string|Item} stockB
 * @returns {number}
 */
function countPair(basketsOrIndex, stockA, stockB) {
  return countItemset(basketsOrIndex, [stockA, stockB]);
}

/**
 * Remove repeated item identities from a raw basket, keeping first-appearance
 * order. A basket is a set of items, so duplicates must not be counted twice.
 *
 * Implemented (HW4): walk the input once, map each entry to its stock code with the
 * provided `stockOf` helper, and return each distinct code the first time it
 * appears.
 *
 * Contract:
 *  - An empty input returns `[]`.
 *  - The input may mix plain strings and `{ stock, description }` objects.
 *  - Only the stock code is returned; the description is dropped.
 *
 * @param {Array<string|Item>} rawItems
 * @returns {Array<string>} unique stock codes, in first-appearance order.
 */
function dedupeBasket(rawItems) {
  // A Set keeps insertion order, which is exactly first-appearance order.
  const seen = new Set();
  for (const item of rawItems || []) seen.add(stockOf(item));
  return [...seen];
}

/**
 * Compute support as `jointCount / n`.
 *
 * Implemented (HW4): return the fraction and flag the `n === 0` case.
 *
 * Contract:
 *  - `defined: true` with `value = jointCount / n` when `n > 0`.
 *  - `defined: false` with `value = 0` when `n === 0` (never divide by zero).
 *
 * @param {number} jointCount count(A union B)
 * @param {number} n          number of baskets
 * @returns {{value: number, defined: boolean}} `defined` is false when `n === 0`.
 */
function computeSupport(jointCount, n) {
  if (!(n > 0)) return { value: 0, defined: false };
  return { value: jointCount / n, defined: true };
}

/**
 * Compute confidence as `jointCount / antecedentCount`.
 *
 * Implemented (HW4): return the fraction and flag the `antecedentCount === 0` case.
 *
 * Contract:
 *  - `defined: true` with `value = jointCount / antecedentCount` when count(A) > 0.
 *  - `defined: false` with `value = 0` when count(A) === 0: a rule whose
 *    left-hand side never occurs has no confidence.
 *
 * @param {number} jointCount      count(A union B)
 * @param {number} antecedentCount count(A)
 * @returns {{value: number, defined: boolean}}
 */
function computeConfidence(jointCount, antecedentCount) {
  if (!(antecedentCount > 0)) return { value: 0, defined: false };
  return { value: jointCount / antecedentCount, defined: true };
}

/**
 * Compute lift as `confidence / (consequentCount / n)`.
 *
 * Implemented (HW4): divide the incoming confidence by the consequent's baseline rate.
 *
 * Contract:
 *  - `defined: true` with `value = confidence.value / (consequentCount / n)`
 *    when every input is usable.
 *  - `defined: false` with `value = 0` when the incoming confidence is missing or
 *    undefined, when `n === 0`, or when the baseline `consequentCount / n` is 0
 *    (the consequent never occurs).
 *
 * @param {{value: number, defined: boolean}} confidence confidence(A -> B)
 * @param {number} consequentCount count(B)
 * @param {number} n               number of baskets
 * @returns {{value: number, defined: boolean}}
 */
function computeLift(confidence, consequentCount, n) {
  if (!confidence || !confidence.defined) return { value: 0, defined: false };
  if (!(n > 0)) return { value: 0, defined: false };
  const baseline = consequentCount / n;
  if (!(baseline > 0)) return { value: 0, defined: false };
  return { value: confidence.value / baseline, defined: true };
}

/**
 * Validate the two slider values, expressed as fractions in `(0, 1]`.
 *
 * @param {number} minSupport    minimum support fraction
 * @param {number} minConfidence minimum confidence fraction
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateThresholds(minSupport, minConfidence) {
  const errors = [];
  for (const [label, value] of [
    ["Minimum support", minSupport],
    ["Minimum confidence", minConfidence],
  ]) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${label} must be a number.`);
    } else if (value <= 0 || value > 1) {
      errors.push(`${label} must be greater than 0 and at most 1.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Mine all frequent itemsets whose support is at least `minSupport`.
 *
 * Implemented (HW4): Apriori — level-wise candidate generation (join step)
 * with a downward-closure pruning step. Candidate supports are counted by
 * intersecting ascending basket-id lists (a vertical layout) instead of
 * re-scanning all baskets at every level.
 *
 * Contract:
 *  - Return one entry per frequent itemset: `{ items, count, support }`, where
 *    `items` is the (deduplicated) set of stock codes, `count` is the number of
 *    baskets containing every item, and `support = count / N`.
 *  - Every returned itemset must satisfy `support >= minSupport`.
 *  - You may call `countItemset` while developing, but a per-candidate scan over
 *    17,080 baskets is slow — build your own occurrence/index structures.
 *  - `generateRules` consumes this exact shape, so keep the field names stable.
 *
 * @param {Array<Array<Item|string>>} transactions baskets
 * @param {number} minSupport minimum support fraction in `(0, 1]`
 * @returns {Array<{items: string[], count: number, support: number}>} frequent itemsets
 */
function findFrequentItemsets(transactions, minSupport) {
  const n = transactions.length;
  if (n === 0) return [];
  // Same comparison the contract states, applied to the same float that is
  // reported as `support`, so the filter and the output can never disagree.
  const isFrequent = (count) => count / n >= minSupport;

  // Pass 1 (basket matrix, stored column-wise): one ascending list of basket
  // ids per stock. Baskets are deduplicated first, so an item repeated inside
  // one invoice still contributes a single basket id.
  /** @type {Map<string, number[]>} */
  const tidsByStock = new Map();
  transactions.forEach((basket, basketId) => {
    for (const stock of dedupeBasket(basket)) {
      const tids = tidsByStock.get(stock);
      if (tids) tids.push(basketId);
      else tidsByStock.set(stock, [basketId]);
    }
  });

  // L1: frequent single items, in a fixed (code-unit) order. Every itemset is
  // kept sorted in that order, so each one has exactly one representation.
  const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  let level = [...tidsByStock.entries()]
    .filter(([, tids]) => isFrequent(tids.length))
    .sort(([a], [b]) => byCode(a, b))
    .map(([stock, tids]) => ({ items: [stock], tids: Int32Array.from(tids) }));

  const frequent = [];
  const emit = (entry) =>
    frequent.push({
      items: entry.items,
      count: entry.tids.length,
      support: entry.tids.length / n,
    });
  level.forEach(emit);

  // Level 2. Every pair of frequent items is a candidate (nothing can be pruned
  // yet), so there are m(m-1)/2 of them: 870,540 at 0.5% support. Intersecting
  // two id lists per candidate is the slow way to count them. One pass over the
  // baskets, bumping a counter for each pair of frequent items a basket holds,
  // gives the same counts; id lists are then built for the frequent pairs only.
  if (level.length > 1) {
    const m = level.length;
    /** @type {number[][]} frequent-item positions per basket, ascending. */
    const itemsOf = Array.from({ length: n }, () => []);
    level.forEach((entry, position) => {
      for (const basketId of entry.tids) itemsOf[basketId].push(position);
    });
    // Upper-triangular counter: pair (i, j), i < j, lives at rowStart(i) + j.
    const rowStart = (i) => i * m - (i * (i + 1)) / 2 - i - 1;
    const pairCount = new Uint32Array((m * (m - 1)) / 2);
    for (const items of itemsOf) {
      for (let a = 0; a < items.length; a += 1) {
        const start = rowStart(items[a]);
        for (let b = a + 1; b < items.length; b += 1) pairCount[start + items[b]] += 1;
      }
    }
    const pairs = [];
    for (let i = 0; i < m; i += 1) {
      const start = rowStart(i);
      for (let j = i + 1; j < m; j += 1) {
        if (!isFrequent(pairCount[start + j])) continue;
        pairs.push({
          items: [level[i].items[0], level[j].items[0]],
          tids: intersectSorted(level[i].tids, level[j].tids),
        });
      }
    }
    pairs.forEach(emit);
    level = pairs;
  }

  // Levels 3 and up: L(k-1) -> candidates C(k) -> L(k).
  while (level.length > 1) {
    const k = level[0].items.length + 1;
    const previousKeys = new Set(level.map((entry) => itemsetKey(entry.items)));
    const next = [];

    for (let i = 0; i < level.length; i += 1) {
      const left = level[i];
      for (let j = i + 1; j < level.length; j += 1) {
        const right = level[j];
        // Join step: two (k-1)-itemsets combine only if they share their first
        // k-2 items. `level` is sorted, so once the prefix differs no later
        // `right` can match this `left`.
        if (!samePrefix(left.items, right.items, k - 2)) break;
        const candidate = [...left.items, right.items[k - 2]];

        // Prune step (downward closure): every (k-1)-subset of a frequent
        // k-itemset must itself be frequent. The two subsets that drop one of
        // the last two items are `left` and `right`; check the others.
        let allSubsetsFrequent = true;
        for (let drop = 0; drop < k - 2 && allSubsetsFrequent; drop += 1) {
          const subset = candidate.filter((_, position) => position !== drop);
          allSubsetsFrequent = previousKeys.has(itemsetKey(subset));
        }
        if (!allSubsetsFrequent) continue;

        // Count step: baskets containing the candidate = baskets containing
        // `left` AND `right` (their union is the candidate).
        const tids = intersectSorted(left.tids, right.tids);
        if (isFrequent(tids.length)) next.push({ items: candidate, tids });
      }
    }

    next.forEach(emit);
    level = next;
  }

  return frequent;
}

/**
 * Canonical string key for an itemset: its stock codes sorted and joined with a
 * separator that cannot occur inside a stock code.
 *
 * @param {string[]} items
 * @returns {string}
 */
function itemsetKey(items) {
  return [...items].sort().join("\u0001");
}

/**
 * True when two sorted itemsets agree on their first `length` items.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @param {number} length
 * @returns {boolean}
 */
function samePrefix(a, b, length) {
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Intersect two ascending basket-id lists with a linear merge.
 *
 * @param {Int32Array} a
 * @param {Int32Array} b
 * @returns {Int32Array}
 */
function intersectSorted(a, b) {
  const out = new Int32Array(Math.min(a.length, b.length));
  let i = 0;
  let j = 0;
  let size = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out[size] = a[i];
      size += 1;
      i += 1;
      j += 1;
    } else if (a[i] < b[j]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return out.subarray(0, size);
}

/**
 * Turn frequent itemsets into association rules and keep the ones whose
 * confidence is at least `minConfidence`.
 *
 * Implemented (HW4): for each frequent itemset, split it into a non-empty antecedent `A`
 * and a non-empty, disjoint consequent `B` in BOTH directions, compute the
 * confidence for each direction, and keep the rules that pass the threshold.
 *
 * Contract:
 *  - Each returned rule follows the `Rule` shape documented at the top of this
 *    module. At minimum it carries `antecedent` and `consequent`; the renderer
 *    fills in the counts and metrics with `enrichRule`, but returning them
 *    yourself is fine and faster.
 *  - Generate both `A -> B` and `B -> A`: they are separate rules with (usually)
 *    different confidence. Skip a direction whose consequent is empty.
 *  - Keep only rules with `confidence >= minConfidence`. `count(A)` is non-zero
 *    for every generated rule, so the confidence is always defined.
 *
 * @param {Array<{items: string[], count: number, support: number}>} frequentItemsets
 * @param {number} minConfidence minimum confidence fraction in `(0, 1]`
 * @returns {Rule[]}
 */
function generateRules(frequentItemsets, minConfidence) {
  // Downward closure guarantees that every subset of a frequent itemset is in
  // the list too, so count(A) and count(B) are plain lookups.
  const countByKey = new Map();
  let n = 0;
  for (const itemset of frequentItemsets) {
    countByKey.set(itemsetKey(itemset.items), itemset.count);
    // N is not passed in; recover it from any itemset (support = count / N).
    if (n === 0 && itemset.support > 0) n = Math.round(itemset.count / itemset.support);
  }

  const rules = [];
  for (const itemset of frequentItemsets) {
    const size = itemset.items.length;
    if (size < 2) continue;
    // Each bitmask selects a non-empty proper subset as the antecedent; the
    // complementary mask yields the opposite direction of the same split.
    for (let mask = 1; mask < (1 << size) - 1; mask += 1) {
      const antecedent = [];
      const consequent = [];
      itemset.items.forEach((stock, position) => {
        if (mask & (1 << position)) antecedent.push(stock);
        else consequent.push(stock);
      });
      const antecedentCount = countByKey.get(itemsetKey(antecedent));
      const consequentCount = countByKey.get(itemsetKey(consequent));
      // Only possible if the caller passed an incomplete itemset list.
      if (antecedentCount === undefined || consequentCount === undefined) continue;

      const confidence = computeConfidence(itemset.count, antecedentCount);
      if (!confidence.defined || confidence.value < minConfidence) continue;
      const lift = computeLift(confidence, consequentCount, n);
      rules.push({
        antecedent,
        consequent,
        jointCount: itemset.count,
        antecedentCount,
        consequentCount,
        support: computeSupport(itemset.count, n).value,
        confidence: confidence.value,
        lift: lift.value,
      });
    }
  }

  // Strongest association first; ties fall back to evidence, then to a fixed
  // textual order so the table is reproducible.
  const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  rules.sort(
    (a, b) =>
      b.lift - a.lift ||
      b.confidence - a.confidence ||
      b.jointCount - a.jointCount ||
      byCode(ruleLabel(a), ruleLabel(b)),
  );
  return rules;
}

/**
 * Stable text label for a rule, used only as a sort tie-break.
 *
 * @param {Rule} rule
 * @returns {string}
 */
function ruleLabel(rule) {
  return `${rule.antecedent.join(",")}>${rule.consequent.join(",")}`;
}

// ---------------------------------------------------------------------------
// Tiny worked example (used by the automated tests and the readout panel)
// ---------------------------------------------------------------------------

/**
 * A five-basket fixture with hand-computed support / confidence / lift values.
 *
 * The fixture is deliberately small enough to check with a pencil:
 *
 *   T1: bread, milk, jam, ham
 *   T2: bread, milk, jam
 *   T3: bread, milk
 *   T4: bread, jam, eggs
 *   T5: bread, eggs
 *
 * Item counts: bread = 5, milk = 3, jam = 3, eggs = 2, ham = 1 (N = 5).
 *
 * Because `bread` appears in every basket, every rule with `bread` on either
 * side has lift exactly 1 — that is the teaching point of the fixture.
 *
 * @returns {{n: number, baskets: string[][], itemCounts: Object<string, number>, rules: Array<Object>}}
 */
function tinyWorkedExample() {
  const baskets = [
    ["bread", "milk", "jam", "ham"],
    ["bread", "milk", "jam"],
    ["bread", "milk"],
    ["bread", "jam", "eggs"],
    ["bread", "eggs"],
  ];
  const n = baskets.length;
  return {
    n,
    baskets,
    itemCounts: { bread: 5, milk: 3, jam: 3, eggs: 2, ham: 1 },
    rules: [
      // lift == 1: bread is in every basket, so confidence equals support(B).
      {
        antecedent: ["bread"],
        consequent: ["milk"],
        jointCount: 3,
        antecedentCount: 5,
        consequentCount: 3,
        support: 3 / n,
        confidence: 3 / 5,
        lift: 1,
      },
      // lift > 1: milk and jam co-occur more than independence predicts.
      {
        antecedent: ["milk"],
        consequent: ["jam"],
        jointCount: 2,
        antecedentCount: 3,
        consequentCount: 3,
        support: 2 / n,
        confidence: 2 / 3,
        lift: (2 / 3) / (3 / 5),
      },
      // lift < 1 (and not degenerate): jam and eggs co-occur less than expected.
      {
        antecedent: ["jam"],
        consequent: ["eggs"],
        jointCount: 1,
        antecedentCount: 3,
        consequentCount: 2,
        support: 1 / n,
        confidence: 1 / 3,
        lift: (1 / 3) / (2 / 5),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Rule normalisation
// ---------------------------------------------------------------------------

/**
 * Fill in any missing counts / metrics on a rule using the dataset index, so the
 * table can render a rule even when the student returns only `antecedent` and
 * `consequent`.
 *
 * @param {Partial<Rule>} rule
 * @param {BasketIndex} index
 * @returns {Rule}
 */
function enrichRule(rule, index) {
  const antecedent = (rule.antecedent || []).map(stockOf);
  const consequent = (rule.consequent || []).map(stockOf);
  const n = index.n || N;
  const jointCount =
    typeof rule.jointCount === "number"
      ? rule.jointCount
      : countItemset(index, [...antecedent, ...consequent]);
  const antecedentCount =
    typeof rule.antecedentCount === "number"
      ? rule.antecedentCount
      : countItemset(index, antecedent);
  const consequentCount =
    typeof rule.consequentCount === "number"
      ? rule.consequentCount
      : countItemset(index, consequent);
  const support = computeSupport(jointCount, n);
  const confidence = computeConfidence(jointCount, antecedentCount);
  const lift = computeLift(confidence, consequentCount, n);
  return {
    antecedent,
    consequent,
    jointCount,
    antecedentCount,
    consequentCount,
    support: typeof rule.support === "number" ? rule.support : support.value,
    confidence:
      typeof rule.confidence === "number" ? rule.confidence : confidence.value,
    lift: typeof rule.lift === "number" ? rule.lift : lift.value,
    supportDefined: support.defined,
    confidenceDefined: confidence.defined,
    liftDefined: lift.defined,
  };
}

/**
 * Swap the antecedent and consequent of a rule and recompute the metrics.
 *
 * Confidence is not symmetric, so `B -> A` usually has a different confidence
 * from `A -> B`. Support and lift are symmetric and stay the same.
 * (HW4 fix: the starter comment said that support changes too.)
 *
 * @param {Rule} rule
 * @param {BasketIndex} index
 * @returns {Rule}
 */
function reverseRule(rule, index) {
  return enrichRule(
    {
      antecedent: rule.consequent,
      consequent: rule.antecedent,
    },
    index,
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a fraction as a percentage with two decimals.
 *
 * @param {number} fraction
 * @returns {string}
 */
function formatPercent(fraction) {
  return `${(fraction * 100).toFixed(2)}%`;
}

/**
 * Format a number with four significant decimals for the results table.
 *
 * @param {number} value
 * @returns {string}
 */
function formatMetric(value) {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(4);
}

/**
 * Text shown in place of a metric whose denominator is zero.
 * (HW4 fix: the starter printed such a metric as `0.00%` / `0.0000`, i.e. as a
 * real value, although `enrichRule` already reports it as not defined.)
 */
const UNDEFINED_LABEL = "undefined";

/**
 * Format a metric, or say that it is undefined.
 *
 * @param {boolean} defined
 * @param {string} text formatted value to show when the metric is defined
 * @returns {string}
 */
function metricText(defined, text) {
  return defined ? text : UNDEFINED_LABEL;
}

/**
 * Corrections to the provenance string embedded in `transactions.js`, which must
 * not be edited. Verified against Crossref (DOI 10.1057/dbm.2012.17) and against
 * the raw UCI workbook; see the report.
 */
const PROVENANCE_NOTE =
  "Correction (HW4): the second author of the source paper is Sai Laing Sain " +
  "(J. Database Marketing & Customer Strategy Management 19(3), 2012). The " +
  "cleaning also removed guest checkouts (blank CustomerID): 132,219 raw rows, " +
  "the largest single filter.";

/**
 * Render a list of stock codes as readable text.
 *
 * @param {string[]} stocks
 * @param {BasketIndex} index
 * @returns {string}
 */
function formatItemset(stocks, index) {
  if (!stocks || stocks.length === 0) return "(empty)";
  return stocks.map((stock) => describe(stock, index)).join(", ");
}

/**
 * Lookup a stock code's canonical description, falling back to the code. Filled
 * by `primeDescriptions()` once `init()` runs.
 */
const descriptionByStock = new Map();

/**
 * Render `STOCK — human readable description` for one item.
 *
 * @param {string} stock
 * @param {BasketIndex} index
 * @returns {string}
 */
function describe(stock, index) {
  const description = descriptionByStock.get(stock);
  return description ? `${stock} — ${description}` : stock;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render the dataset summary at the top of the page: total baskets, distinct
 * items, and the top five items by basket count.
 *
 * @param {BasketIndex} index
 * @param {HTMLElement|null} container
 * @returns {void}
 */
function renderDatasetSummary(index, container) {
  const target = container || document.getElementById("dataset-summary-body");
  if (!target) return;

  const counts = [...index.byStock.entries()]
    .map(([stock, posting]) => ({ stock, count: posting.size }))
    .sort((a, b) => b.count - a.count || a.stock.localeCompare(b.stock));
  const topFive = counts.slice(0, 5);

  const rows = topFive
    .map(
      (entry, i) =>
        `<tr><td class="num">${i + 1}</td><td>${escapeHtml(
          describe(entry.stock, index),
        )}</td><td class="num">${entry.count}</td></tr>`,
    )
    .join("");

  target.innerHTML = `
    <p class="summary-line">
      <strong>${index.n.toLocaleString("en-US")}</strong> baskets ·
      <strong>${index.byStock.size.toLocaleString("en-US")}</strong> distinct items
    </p>
    <details class="top-items">
      <summary>Top 5 items by basket count</summary>
      <table class="data-table">
        <thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col">Baskets</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>
    <p class="provenance">${escapeHtml(data.dataset_provenance)}</p>
    <p class="provenance">${escapeHtml(PROVENANCE_NOTE)}</p>
  `;
}

/**
 * Render the rule list into a table. Each row is clickable and shows the rule in
 * the detail panel.
 *
 * @param {Rule[]} rules
 * @param {BasketIndex} [index]
 * @param {HTMLElement|null} [container]
 * @param {(rendered: number, total: number) => void} [onProgress] called as rows
 *   reach the page; `rendered === total` means the table is complete.
 * @returns {void}
 */
function renderResults(rules, index, container, onProgress) {
  const target = container || document.getElementById("results");
  if (!target) return;
  const activeIndex = index || DATASET_INDEX;
  const token = (resultsRenderToken += 1);
  const report = (rendered) => {
    if (onProgress) onProgress(rendered, rules ? rules.length : 0);
  };

  if (!rules || rules.length === 0) {
    target.innerHTML =
      '<p class="empty-state">No rules passed the current thresholds. ' +
      "Lower the minimum support or confidence and run again.</p>";
    report(0);
    return;
  }

  const rowHtml = (rule, rowIndex) => {
    const enriched = enrichRule(rule, activeIndex);
    return `
        <tr tabindex="0" data-rule-index="${rowIndex}">
          <td>${escapeHtml(formatItemset(enriched.antecedent, activeIndex))}</td>
          <td>${escapeHtml(formatItemset(enriched.consequent, activeIndex))}</td>
          <td class="num">${enriched.jointCount}</td>
          <td class="num">${enriched.antecedentCount}</td>
          <td class="num">${enriched.consequentCount}</td>
          <td class="num">${metricText(enriched.supportDefined, formatPercent(enriched.support))}</td>
          <td class="num">${metricText(enriched.confidenceDefined, formatPercent(enriched.confidence))}</td>
          <td class="num">${metricText(enriched.liftDefined, formatMetric(enriched.lift))}</td>
        </tr>`;
  };
  const rowsHtml = (from, to) => {
    let html = "";
    for (let i = from; i < to; i += 1) html += rowHtml(rules[i], i);
    return html;
  };

  // HW4 fix: the starter built all rows in one go. With 19,058 rules (0.5% /
  // 10%) that froze the page for seconds. Tables up to FIRST_ROWS rows are still
  // rendered at once; longer ones show their first rows immediately and the
  // rest is appended between frames, so the page stays responsive.
  const canDefer = typeof requestAnimationFrame === "function";
  const first = canDefer ? Math.min(rules.length, FIRST_ROWS) : rules.length;

  target.innerHTML = `
    <p class="results-count">${rules.length} rule${rules.length === 1 ? "" : "s"}.</p>
    <div style="overflow-x: auto">
    <table class="data-table rules-table">
      <thead>
        <tr>
          <th scope="col">Antecedent (A)</th>
          <th scope="col">Consequent (B)</th>
          <th scope="col">count(A∪B)</th>
          <th scope="col">count(A)</th>
          <th scope="col">count(B)</th>
          <th scope="col">support</th>
          <th scope="col">confidence</th>
          <th scope="col">lift</th>
        </tr>
      </thead>
      <tbody>${rowsHtml(0, first)}</tbody>
    </table>
    </div>`;

  // HW4 fix: one delegated listener pair on the table's container instead of
  // two listeners on every row (38,116 listeners at the lowest thresholds).
  const scroller = target.querySelector("div");
  const ruleOf = (event) => {
    const row = event.target && event.target.closest ? event.target.closest("tr[data-rule-index]") : null;
    return row ? rules[Number(row.dataset.ruleIndex)] : null;
  };
  if (scroller) {
    scroller.addEventListener("click", (event) => {
      const rule = ruleOf(event);
      if (rule) renderRuleDetail(rule, activeIndex);
    });
    scroller.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const rule = ruleOf(event);
      if (!rule) return;
      event.preventDefault();
      renderRuleDetail(rule, activeIndex);
    });
  }

  if (first === rules.length) {
    report(first);
    return;
  }

  // Freeze the column widths measured on the first rows, then append every
  // further chunk as a table of its own with the same fixed columns. Appending
  // rows to one growing table makes the browser lay the whole table out again
  // each time, so the cost per chunk grows with the table; a separate table per
  // chunk keeps it constant. The tables are stacked without a gap and read as one.
  const table = target.querySelector("table");
  const headers = [...table.querySelectorAll("th")];
  const widths = headers.map((th) => th.getBoundingClientRect().width);
  const total = widths.reduce((sum, width) => sum + width, 0) || 1;
  const percents = widths.map((width) => `${(width / total) * 100}%`);
  headers.forEach((th, i) => {
    th.style.width = percents[i];
  });
  const fixedLayout = `table-layout: fixed; min-width: ${Math.ceil(total)}px;`;
  table.style.cssText += fixedLayout;
  const columns = `<colgroup>${percents.map((width) => `<col style="width: ${width}">`).join("")}</colgroup>`;

  let rendered = first;
  report(rendered);
  const appendChunk = () => {
    // A newer run has replaced this table: stop quietly.
    if (token !== resultsRenderToken || !scroller.isConnected) return;
    const upTo = Math.min(rules.length, rendered + CHUNK_ROWS);
    scroller.insertAdjacentHTML(
      "beforeend",
      `<table class="data-table rules-table" style="${fixedLayout} margin-top: -1px;">${columns}<tbody>${rowsHtml(rendered, upTo)}</tbody></table>`,
    );
    rendered = upTo;
    report(rendered);
    if (rendered < rules.length) requestAnimationFrame(() => setTimeout(appendChunk, 0));
  };
  requestAnimationFrame(() => setTimeout(appendChunk, 0));
}

/** Rows rendered immediately; a table of at most this size is built in one go. */
const FIRST_ROWS = 1000;
/** Rows appended per frame for longer tables. */
const CHUNK_ROWS = 1000;
/** Identifies the latest `renderResults` call, so an older one can stop appending. */
let resultsRenderToken = 0;

/**
 * Render the detail panel for one selected rule, including a "Reverse direction"
 * button that swaps A and B and re-renders the panel.
 *
 * Shows an inline note when `count(A)` or `count(B)` is zero, because confidence
 * and lift are then undefined.
 *
 * @param {Rule} rule
 * @param {BasketIndex} [index]
 * @param {HTMLElement|null} [container]
 * @returns {void}
 */
function renderRuleDetail(rule, index, container) {
  const target = container || document.getElementById("rule-detail");
  if (!target) return;
  const activeIndex = index || DATASET_INDEX;
  const enriched = enrichRule(rule, activeIndex);
  const reversed = reverseRule(enriched, activeIndex);

  const zeroDenominatorNotes = [];
  // HW4 fix: lift divides by count(A) (through confidence) and by count(B), and
  // the reverse confidence divides by count(B); the starter notes named only one
  // of the affected metrics in each case.
  if (enriched.antecedentCount === 0) {
    zeroDenominatorNotes.push(
      "count(A) = 0, so confidence(A → B) and lift are undefined (division by zero).",
    );
  }
  if (enriched.consequentCount === 0) {
    zeroDenominatorNotes.push(
      "count(B) = 0, so lift and the reverse confidence(B → A) are undefined (division by zero).",
    );
  }
  const noteHtml = zeroDenominatorNotes.length
    ? `<p class="warning">${zeroDenominatorNotes.map(escapeHtml).join(" ")}</p>`
    : "";

  target.innerHTML = `
    <dl class="rule-metrics">
      <dt>Antecedent (A)</dt><dd>${escapeHtml(formatItemset(enriched.antecedent, activeIndex))}</dd>
      <dt>Consequent (B)</dt><dd>${escapeHtml(formatItemset(enriched.consequent, activeIndex))}</dd>
      <dt>count(A∪B)</dt><dd class="num">${enriched.jointCount}</dd>
      <dt>count(A)</dt><dd class="num">${enriched.antecedentCount}</dd>
      <dt>count(B)</dt><dd class="num">${enriched.consequentCount}</dd>
      <dt>support</dt><dd class="num">${metricText(enriched.supportDefined, formatPercent(enriched.support))}</dd>
      <dt>confidence</dt><dd class="num">${metricText(enriched.confidenceDefined, formatPercent(enriched.confidence))}</dd>
      <dt>lift</dt><dd class="num">${metricText(enriched.liftDefined, formatMetric(enriched.lift))}</dd>
    </dl>
    <p class="comparison">
      Reverse direction (B → A): confidence
      <strong>${metricText(reversed.confidenceDefined, formatPercent(reversed.confidence))}</strong>, lift
      <strong>${metricText(reversed.liftDefined, formatMetric(reversed.lift))}</strong>.
      Confidence changes with direction; lift does not.
    </p>
    ${noteHtml}
    <button type="button" id="reverse-rule">Reverse direction (B → A)</button>
  `;

  const button = target.querySelector("#reverse-rule");
  button.addEventListener("click", () => {
    renderRuleDetail(reversed, activeIndex, target);
  });
}

/**
 * Render the optional worked-example readout panel.
 *
 * @param {ReturnType<typeof tinyWorkedExample>} example
 * @param {HTMLElement|null} [container]
 * @returns {void}
 */
function renderWorkedExample(example, container) {
  const target = container || document.getElementById("worked-example");
  if (!target) return;
  const rows = example.rules
    .map(
      (rule) => `
      <tr>
        <td>${rule.antecedent.join(", ")}</td>
        <td>${rule.consequent.join(", ")}</td>
        <td class="num">${rule.jointCount}</td>
        <td class="num">${rule.antecedentCount}</td>
        <td class="num">${rule.consequentCount}</td>
        <td class="num">${formatPercent(rule.support)}</td>
        <td class="num">${formatPercent(rule.confidence)}</td>
        <td class="num">${formatMetric(rule.lift)}</td>
      </tr>`,
    )
    .join("");
  target.innerHTML = `
    <p class="worked-example-intro">
      Five hand-built baskets, N = ${example.n}. The top row has lift exactly 1
      because <code>bread</code> appears in every basket; the second has lift &gt; 1;
      the third has lift &lt; 1.
    </p>
    <div style="overflow-x: auto">
    <table class="data-table">
      <thead>
        <tr>
          <th scope="col">A</th><th scope="col">B</th>
          <th scope="col">count(A∪B)</th><th scope="col">count(A)</th><th scope="col">count(B)</th>
          <th scope="col">support</th><th scope="col">confidence</th><th scope="col">lift</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

/**
 * Text of the empty "Selected rule" panel (same wording as in index.html).
 */
const NO_RULE_SELECTED_HTML =
  '<p class="empty-state">Click a rule row to inspect it.</p>';

/**
 * Escape text before inserting it into HTML.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/** Marker thrown by unimplemented `TODO(hw4)` stubs. */
const TODO_MARKER = "TODO(hw4)";

/**
 * Run the automated self-checks against the five-basket worked example and the
 * reference helpers. Unimplemented `TODO(hw4)` functions are reported as
 * `pending` rather than `fail`, so the harness is useful before and after the
 * assignment is implemented.
 *
 * @param {HTMLElement|null} [logElement] element that receives the text log
 * @returns {{passed: number, failed: number, pending: number, checks: Array<Object>}}
 */
function runTests(logElement) {
  const example = tinyWorkedExample();
  const checks = [];
  const basketObjects = example.baskets;

  const pass = (name, detail) => checks.push({ name, status: "PASS", detail });
  const fail = (name, detail) => checks.push({ name, status: "FAIL", detail });
  const pending = (name, detail) => checks.push({ name, status: "PENDING", detail });

  const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

  const check = (name, fn) => {
    try {
      const outcome = fn();
      if (outcome && outcome.pending) pending(name, outcome.pending);
      else pass(name, outcome === undefined ? "" : String(outcome));
    } catch (error) {
      if (String(error && error.message).includes(TODO_MARKER)) {
        pending(name, "TODO(hw4): not implemented yet.");
      } else {
        fail(name, String(error && error.message ? error.message : error));
      }
    }
  };

  // 1. Item counts on the fixture.
  check("fixture: item counts match the hand-computed values", () => {
    for (const [stock, expected] of Object.entries(example.itemCounts)) {
      const actual = countItem(basketObjects, stock);
      if (actual !== expected) {
        throw new Error(`countItem(${stock}) = ${actual}, expected ${expected}`);
      }
    }
    return "all five item counts correct";
  });

  // 2. lift == 1 case.
  check("fixture: bread -> milk has lift exactly 1", () => {
    const [breadMilk] = example.rules;
    const joint = countPair(basketObjects, "bread", "milk");
    const support = computeSupport(joint, example.n);
    const confidence = computeConfidence(joint, countItem(basketObjects, "bread"));
    const lift = computeLift(confidence, countItem(basketObjects, "milk"), example.n);
    if (!close(support.value, breadMilk.support)) throw new Error("support mismatch");
    if (!close(confidence.value, breadMilk.confidence)) throw new Error("confidence mismatch");
    if (!close(lift.value, breadMilk.lift)) throw new Error(`lift = ${lift.value}, expected 1`);
    return `support=${support.value.toFixed(4)} confidence=${confidence.value.toFixed(4)} lift=${lift.value.toFixed(4)}`;
  });

  // 3. lift > 1 case.
  check("fixture: milk -> jam has lift greater than 1", () => {
    const rule = example.rules[1];
    const joint = countPair(basketObjects, rule.antecedent[0], rule.consequent[0]);
    const confidence = computeConfidence(joint, countItem(basketObjects, rule.antecedent[0]));
    const lift = computeLift(confidence, countItem(basketObjects, rule.consequent[0]), example.n);
    if (!close(lift.value, rule.lift)) throw new Error(`lift = ${lift.value}, expected ${rule.lift}`);
    if (!(lift.value > 1)) throw new Error("expected lift > 1");
    return `lift=${lift.value.toFixed(4)} (> 1)`;
  });

  // 4. lift < 1 case.
  check("fixture: jam -> eggs has lift less than 1", () => {
    const rule = example.rules[2];
    const joint = countPair(basketObjects, rule.antecedent[0], rule.consequent[0]);
    const confidence = computeConfidence(joint, countItem(basketObjects, rule.antecedent[0]));
    const lift = computeLift(confidence, countItem(basketObjects, rule.consequent[0]), example.n);
    if (!close(lift.value, rule.lift)) throw new Error(`lift = ${lift.value}, expected ${rule.lift}`);
    if (!(lift.value < 1 && lift.value > 0)) throw new Error("expected 0 < lift < 1");
    return `lift=${lift.value.toFixed(4)} (0 < lift < 1)`;
  });

  // 5. Reversed confidence differs.
  check("fixture: reversed confidence differs (jam <-> eggs)", () => {
    const forwardJoint = countPair(basketObjects, "jam", "eggs");
    const forward = computeConfidence(forwardJoint, countItem(basketObjects, "jam"));
    const reversed = computeConfidence(forwardJoint, countItem(basketObjects, "eggs"));
    if (close(forward.value, reversed.value)) {
      throw new Error("confidence should differ between jam -> eggs and eggs -> jam");
    }
    if (!close(forward.value, 1 / 3) || !close(reversed.value, 1 / 2)) {
      throw new Error(`unexpected values: ${forward.value} vs ${reversed.value}`);
    }
    return `jam->eggs=${forward.value.toFixed(4)} vs eggs->jam=${reversed.value.toFixed(4)}`;
  });

  // 6. Duplicate items in a raw basket are counted once.
  check("duplicate items in a raw basket are counted once", () => {
    const deduped = dedupeBasket(["milk", "bread", "milk", "bread", "jam"]);
    if (deduped.length !== 3) throw new Error(`expected 3 unique items, got ${deduped.length}`);
    const duplicateBasket = [["milk", "bread", "milk", "bread"], ["milk"]];
    if (countItem(duplicateBasket, "milk") !== 2) {
      throw new Error("countItem must count each basket once, not each row");
    }
    if (countPair(duplicateBasket, "milk", "bread") !== 1) {
      throw new Error("countPair must count each basket once");
    }
    return "dedupeBasket removed repeats; counting is per basket";
  });

  // 7. Empty result set renders an empty-state note.
  check("empty rule set renders an empty-state note", () => {
    const scratch = document.createElement("div");
    renderResults([], DATASET_INDEX, scratch);
    if (!/no rules passed/i.test(scratch.textContent)) {
      throw new Error("expected an empty-state message");
    }
    return "empty state rendered";
  });

  // 8. Invalid thresholds are rejected.
  check("invalid thresholds are rejected", () => {
    if (validateThresholds(0.01, 0.3).ok !== true) throw new Error("valid thresholds rejected");
    if (validateThresholds(Number.NaN, 0.3).ok !== false) throw new Error("NaN support accepted");
    if (validateThresholds(0.01, 1.5).ok !== false) throw new Error("confidence > 1 accepted");
    if (validateThresholds(0, 0.3).ok !== false) throw new Error("zero support accepted");
    return "valid accepted, invalid rejected";
  });

  // 9. Zero-denominator guards.
  check("zero-denominator guards return undefined metrics", () => {
    if (computeConfidence(0, 0).defined !== false) throw new Error("count(A)=0 must be undefined");
    if (computeLift({ value: 0.5, defined: true }, 0, 5).defined !== false) {
      throw new Error("count(B)=0 must be undefined");
    }
    if (computeSupport(0, 0).defined !== false) throw new Error("N=0 must be undefined");
    return "zero denominators return defined=false";
  });

  // 10. Student function: frequent itemsets (pending until implemented).
  check("findFrequentItemsets reproduces the fixture's frequent itemsets", () => {
    const itemsets = findFrequentItemsets(basketObjects, 0.4);
    const pairs = itemsets.filter((set) => set.items.length === 2);
    if (pairs.length === 0) throw new Error("no frequent pairs found at support >= 0.4");
    return `${itemsets.length} itemsets`;
  });

  // 11. Student function: rules (pending until implemented).
  check("generateRules reproduces the fixture's rules", () => {
    const itemsets = findFrequentItemsets(basketObjects, 0.2);
    const rules = generateRules(itemsets, 0.5);
    if (rules.length === 0) throw new Error("no rules found at support >= 0.2, confidence >= 0.5");
    return `${rules.length} rules`;
  });

  const passed = checks.filter((c) => c.status === "PASS").length;
  const failed = checks.filter((c) => c.status === "FAIL").length;
  const pendingCount = checks.filter((c) => c.status === "PENDING").length;

  const lines = [
    `HW4 self-checks — pass ${passed}, fail ${failed}, pending ${pendingCount} (of ${checks.length})`,
    "",
    ...checks.map((c) => `${c.status.padEnd(7)} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
  ];
  const text = lines.join("\n");

  const target = logElement || document.getElementById("testLog");
  if (target) target.textContent = text;

  return { passed, failed, pending: pendingCount, checks };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Populate the stock -> description lookup used by the renderers from the
 * dictionary-encoded tables embedded in `window.HW4`.
 *
 * @returns {void}
 */
function primeDescriptions() {
  data.stocks.forEach((stock, i) => {
    if (!descriptionByStock.has(stock)) {
      descriptionByStock.set(stock, data.descriptions[i]);
    }
  });
}

/**
 * Read the two sliders and return the thresholds as fractions in `(0, 1]`.
 *
 * @returns {{minSupport: number, minConfidence: number}}
 */
function readThresholds() {
  const supportInput = document.getElementById("min-support");
  const confidenceInput = document.getElementById("min-confidence");
  return {
    minSupport: Number(supportInput.value) / 100,
    minConfidence: Number(confidenceInput.value) / 100,
  };
}

/**
 * Update the `<output>` readouts next to the two sliders.
 *
 * HW4 fix (accessibility): an `<output>` is a live region by default
 * (`role="status"`, polite), and it sits inside the slider's `<label>`. Every
 * step of a slider therefore made a screen reader read the readout again, on top
 * of the slider's own value, and that value was announced as a bare number
 * ("1.5") without the percent sign. The readout is now a visual duplicate only
 * (not live, hidden from assistive technology), and the slider itself carries
 * the formatted value in `aria-valuetext`, so it is announced once.
 */
function syncThresholdLabels() {
  const supportInput = document.getElementById("min-support");
  const confidenceInput = document.getElementById("min-confidence");
  const supportOutput = document.getElementById("min-support-value");
  const confidenceOutput = document.getElementById("min-confidence-value");
  const supportText = `${Number(supportInput.value).toFixed(1)}%`;
  const confidenceText = `${Number(confidenceInput.value).toFixed(0)}%`;
  for (const [input, output, text] of [
    [supportInput, supportOutput, supportText],
    [confidenceInput, confidenceOutput, confidenceText],
  ]) {
    if (input) input.setAttribute("aria-valuetext", text);
    if (!output) continue;
    output.setAttribute("aria-live", "off");
    output.setAttribute("aria-hidden", "true");
    output.textContent = text;
  }
}

/**
 * Read the thresholds, run the student pipeline, and render the results.
 *
 * @returns {void}
 */
function runPipeline() {
  const status = document.getElementById("status");
  if (!DATASET_INDEX) {
    if (status) {
      status.textContent = "Dataset not ready yet — reload the page.";
    }
    return;
  }
  const { minSupport, minConfidence } = readThresholds();
  const validation = validateThresholds(minSupport, minConfidence);
  if (!validation.ok) {
    if (status) status.textContent = validation.errors.join(" ");
    return;
  }
  // HW4 fix: the starter set this status and then mined in the same task, so
  // the browser could not paint it: "Mining…" never appeared and the page just
  // froze until "Done". The work now starts after the next painted frame, and
  // the button is disabled so that a second click cannot queue a second run.
  const runButton = document.getElementById("run-rules");
  const finish = (text) => {
    if (status) status.textContent = text;
    if (runButton) runButton.disabled = false;
  };
  const work = () => {
    try {
      const itemsets = findFrequentItemsets(TRANSACTIONS, minSupport);
      const rules = generateRules(itemsets, minConfidence);
      const doneText = `Done — ${rules.length} rule(s) at support ≥ ${(minSupport * 100).toFixed(1)}% and confidence ≥ ${(minConfidence * 100).toFixed(0)}%.`;
      // HW4 fix: the starter kept showing the previously selected rule here even
      // when the new thresholds no longer admit it.
      const detailEl = document.getElementById("rule-detail");
      if (detailEl) detailEl.innerHTML = NO_RULE_SELECTED_HTML;
      renderResults(rules, DATASET_INDEX, null, (rendered, total) => {
        if (rendered >= total) finish(doneText);
        else if (status) {
          status.textContent = `Rendering rows… ${rendered.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
        }
      });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      const resultsEl = document.getElementById("results");
      if (resultsEl) {
        resultsEl.innerHTML =
          '<p class="empty-state">Run failed &mdash; the rule miner did not complete. ' +
          `Error: ${escapeHtml(message)}</p>`;
      }
      finish(message);
    }
  };

  if (status) status.textContent = "Mining frequent itemsets…";
  if (runButton) runButton.disabled = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => setTimeout(work, 0));
  } else {
    work();
  }
}

/**
 * Wire the controls once the DOM is ready, then build the dataset index from the
 * baskets already decoded from `window.HW4` and render the summary.
 *
 * The data is already in memory (embedded by `transactions.js`), so there is no
 * fetch and no error path beyond the `window.HW4` guard at the top of this file.
 *
 * @returns {void}
 */
function init() {
  renderWorkedExample(tinyWorkedExample());
  syncThresholdLabels();

  const supportInput = document.getElementById("min-support");
  const confidenceInput = document.getElementById("min-confidence");
  if (supportInput) supportInput.addEventListener("input", syncThresholdLabels);
  if (confidenceInput) confidenceInput.addEventListener("input", syncThresholdLabels);

  const runButton = document.getElementById("run-rules");
  if (runButton) runButton.addEventListener("click", runPipeline);

  const testButton = document.getElementById("run-tests");
  if (testButton) testButton.addEventListener("click", () => runTests());

  const status = document.getElementById("status");
  primeDescriptions();
  N = TRANSACTIONS.length;
  DATASET_INDEX = buildIndex(TRANSACTIONS);
  try {
    renderDatasetSummary(DATASET_INDEX);
  } catch (error) {
    // `renderDatasetSummary` is scaffolding, but guard it defensively so that an
    // unimplemented TODO(hw4) stub can never take the whole page down at load
    // time. The harness's "Run tests" button stays usable regardless.
    const summary = document.getElementById("dataset-summary-body");
    if (summary) {
      summary.innerHTML =
        '<p class="empty-state">Implement the TODO(hw4) functions to activate ' +
        "the dataset summary.</p>";
    }
  }
  if (status) {
    status.textContent = `Dataset ready: ${N.toLocaleString("en-US")} baskets, ${data.N_ITEMS.toLocaleString("en-US")} distinct items. Set the thresholds and press “Run rules”.`;
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
