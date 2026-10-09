// Runs the page's own runTests() harness. Usage: node tests/run_page_tests.js [app|starter_original]
const dir = process.argv[2] || 'app';
const app = require('./harness').load(dir);
const log = app.document.getElementById('testLog');
const r = app.runTests(log);
console.log(`[${dir}]`);
console.log(log.textContent);
