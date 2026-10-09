// Loads transactions.js + script.js into a Node `vm` context with a minimal DOM
// stub, so the page's own functions can be called from tests without a browser.
// Usage: const app = require('./harness').load('app');   // or 'starter_original'
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeElement() {
  const el = {
    innerHTML: '', _text: '', dataset: {}, value: '',
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return makeElement(); },
    attributes: {}, setAttribute(k, v) { el.attributes[k] = String(v); }, getAttribute(k) { return k in el.attributes ? el.attributes[k] : null; },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text || el.innerHTML.replace(/<[^>]*>/g, ' '); },
    set(v) { el._text = String(v); },
  });
  return el;
}

function load(dir) {
  const root = path.join(__dirname, '..', dir);
  const elements = new Map();
  const document = {
    readyState: 'complete',
    body: makeElement(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); },
    createElement: makeElement,
    addEventListener() {},
  };
  document.getElementById('min-support').value = '1';
  document.getElementById('min-confidence').value = '30';
  const sandbox = { document, console, Map, Set, WeakMap, Int32Array, Math, Number, String, Object, Array, Error, JSON };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'transactions.js'), 'utf8'), sandbox, { filename: 'transactions.js' });
  // Top-level const/let/function are script-scoped; export the ones the tests use.
  const names = ['TRANSACTIONS', 'DATASET_INDEX', 'N', 'data', 'dedupeBasket', 'countItemset', 'countItem', 'countPair',
    'computeSupport', 'computeConfidence', 'computeLift', 'findFrequentItemsets', 'generateRules', 'tinyWorkedExample',
    'enrichRule', 'reverseRule', 'runTests', 'renderRuleDetail', 'renderResults', 'descriptionByStock', 'validateThresholds',
    'formatPercent', 'formatMetric', 'buildIndex', 'runPipeline', 'renderDatasetSummary', 'syncThresholdLabels'];
  const src = fs.readFileSync(path.join(root, 'script.js'), 'utf8') +
    `\n;window.__app = { ${names.map((n) => `get ${n}() { return typeof ${n} === 'undefined' ? undefined : ${n}; }`).join(', ')} };`;
  vm.runInContext(src, sandbox, { filename: 'script.js' });
  return Object.assign(sandbox.__app, { document, elements });
}

module.exports = { load };
