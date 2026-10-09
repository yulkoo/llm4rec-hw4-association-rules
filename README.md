# HW4 — Association Rules (UCI Online Retail)

Homework 4 of the LLM4Rec course (HSE University): association-rule mining in the browser.

- Starter code: [dryjins/RecSys-LLMs, week4](https://github.com/dryjins/RecSys-LLMs/tree/main/week4) (MIT License, © 2025 Joseph Seungmin Jin).
  `starter_original/` is that starter, unmodified; `app/` is the starter with my implementation and fixes.
- Data: UCI Machine Learning Repository, *Online Retail* (dataset 352), https://doi.org/10.24432/C5BW33, as cleaned and
  embedded in `transactions.js` by the course starter.
- Not in this repository: the report (submitted separately, so `report/` paths below are local), the downloaded raw
  workbook (`analysis/raw/`) and the Python virtual environment.

- `app/` — **the deliverable** (week4 starter + implementation). Open `app/index.html` in a browser (works from `file://`).
  - `script.js`: the seven `TODO(hw4)` stubs implemented — `dedupeBasket`, `countItemset`, `computeSupport`,
    `computeConfidence`, `computeLift`, `findFrequentItemsets` (Apriori: join + prune, counting by basket-id list
    intersection), `generateRules` (both directions, sorted by lift). `transactions.js`, `index.html`, `style.css` are unchanged.
  - Starter defects fixed (report Table IV): undefined metrics printed as 0.00%, stale "Selected rule" panel, table overflow on
    narrow screens, wrong comment on `reverseRule`, provenance correction line, and the freeze on "Run rules" (status now painted,
    pairs counted in one pass, rows drawn in chunks), slider readout no longer a live region (aria-valuetext on the slider); `readme.md`: source citation and zero-denominator note.
- `starter_original/` — unmodified starter (commit a4f53be), for before/after.
- `tests/` — `node tests/test_app.js` (27 tests), `node tests/a11y_sliders.mjs` (slider accessibility tree; before/after outputs saved), `node tests/audit_page.mjs` (starter-defect audit in Chrome; `audit_page_before_fix.txt` / `audit_page_output.txt`), `node tests/run_page_tests.js [app|starter_original]` (the page's own 11 checks),
  `node tests/browser_check.mjs [app|starter_original]` (headless Chrome, also writes `report/fig/app_rules.png`),
  `node tests/export_results.js` (sweep → `analysis/js_results.json`), `node tests/slider_grid.js` (all 380 slider positions),
  `node tests/timing.js`, `node tests/perf_click.mjs` (click-to-paint and freeze time; `perf_click_before_fix.txt` / `perf_click_output.txt`), `node tests/open_links.mjs <urls>` (opens DOI links in Chrome), `python3 tests/check_report_numbers.py` (report vs outputs); `*_output.txt` = saved outputs.
- `analysis/` — verification only, **not part of the submission** (the README of the assignment asks for no Python):
  `rebuild_from_raw.py` (rebuilds the baskets from the raw UCI workbook), `crosscheck.py` (mlxtend FP-Growth + brute force),
  `analysis.py` → `analysis_results.json` (rule metrics, size-adjusted lift, period check),
  `slider_grid_check.py` (380 slider positions vs FP-Growth), `recheck_extra.py` (counts from the raw workbook, null model), `audit_data.py` (dataset vs raw workbook). Uses `analysis/.venv`
  (`python3 -m venv .venv && .venv/bin/pip install mlxtend pandas openpyxl`) and `analysis/raw/` (downloaded workbook).
- `report/report.html` → `report/filatkina_yulia_a04_report.pdf` (Chrome print-to-PDF).
- `rule_tables/` — the two rule tables cited in the report, exactly as the page's functions return them (1%/30%: 950 rules; 3%/60%: 5 rules).
