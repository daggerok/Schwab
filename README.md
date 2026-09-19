# Schwab

Schwab ETF holdings to Watchlist. A single-file client-side tool that reads the generated `./api/schwab` static feed (the official Schwab Asset Management product finder and per-fund product pages, the per-fund holdings and distribution CSV exports published on schwabassetmanagement.com, Yahoo Finance daily history, and SEC EDGAR N-PORT-P only as a holdings fallback) into a searchable ETF / asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Shared UI contract

The common interaction and data-state rules are documented in [`docs/ui-contract.md`](./docs/ui-contract.md). New provider-specific behavior preserves this contract. The Schwab-specific data plan, source decisions and coverage limitations are documented in [`docs/plan-schwab.md`](./docs/plan-schwab.md).

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| Amplify ETF Holdings to Watchlist | Amplify ETFs (Firestore data feed) | [daggerok/Amplify](https://github.com/daggerok/Amplify) · [published app](https://daggerok.github.io/Amplify/) |
| iShares Excel .xls to Watchlist | iShares (BlackRock) product workbooks | [daggerok/iShares](https://github.com/daggerok/iShares) · [published app](https://daggerok.github.io/iShares/) |
| SPDR ETF Holdings to Watchlist | SSGA / State Street public feeds | [daggerok/SPDR](https://github.com/daggerok/SPDR) · [published app](https://daggerok.github.io/SPDR/) |
| Fidelity ETF Holdings to Watchlist | SEC EDGAR N-PORT-P + Yahoo Finance | [daggerok/Fidelity](https://github.com/daggerok/Fidelity) · [published app](https://daggerok.github.io/Fidelity/) |
| Invesco ETF Holdings to Watchlist | Invesco public downloads + Yahoo Finance | [daggerok/Invesco](https://github.com/daggerok/Invesco) · [published app](https://daggerok.github.io/Invesco/) |
| WisdomTree ETF Holdings to Watchlist | WisdomTree U.S. product table + SEC EDGAR N-PORT-P + Yahoo Finance | [daggerok/WisdomTree](https://github.com/daggerok/WisdomTree) · [published app](https://daggerok.github.io/WisdomTree/) |
| Schwab ETF Holdings to Watchlist | schwabassetmanagement.com product pages + CSV exports + Yahoo Finance | [daggerok/Schwab](https://github.com/daggerok/Schwab) · [published app](https://daggerok.github.io/Schwab/) |

## Using Bun

```bash
bunx degit daggerok/Schwab#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Schwab/>.

The application is a static site: `index.html` loads `app.tsx` through Babel standalone and reads `api/schwab/index.json` plus the paginated fund files with relative URLs. It can be hosted by GitHub Pages or any static file server — there is no build step and no npm runtime dependency.

## Updating the static Schwab data

Run the zero-dependency updater with Bun:

```bash
bun test scripts/update-data.test.ts
bun ./scripts/update-data.ts
```

Run `bun ./scripts/update-data.ts --help` to print the configuration variables and examples. The **Update Schwab ETF data** GitHub Actions workflow exposes the same settings as manual inputs (`workflow_dispatch` only; a successful run commits only `api/schwab/**`). All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| ETF catalog (33 funds), asset class, gross/net expense ratio, inception date | The official product finder filtered to ETFs: [`schwabassetmanagement.com/product-finder?…=291`](https://www.schwabassetmanagement.com/product-finder?combine=&field_product_solution_target_id%5B0%5D=291&field_product_solution_target_id%5B1%5D=291). The updater requests the page directly with a browser-like User-Agent first and falls back to a read-only `r.jina.ai` rendering of the same official URL (the issuer CDN answers datacenter clients, including GitHub Actions, with `Access Denied`). |
| Per-fund NAV (+ as-of), Total Net Assets (+ as-of), Total Expense Ratio, Index Name, Shares Outstanding, Total Holdings, Portfolio Turnover, Morningstar Category, CUSIP, Exchange, SEC Yield (30 Day), Distribution Yield (TTM), Premium/Discount, official NAV and Market Price total returns (monthly and quarterly tables) | The official product page `https://www.schwabassetmanagement.com/products/<ticker>`, rendered through the same read-only proxy when necessary. Both the direct HTML and the proxied markdown are normalized to one line/cell model before parsing. |
| Latest full holdings per fund | The dated **Export All Holdings** CSV linked from the product page (`…/product_files/<TICKER>/<TICKER>_FundHoldings_<YYYY-MM-DD>.CSV`): `As-Of-Date, Symbol, Quantity, Percent of Assets, Name, BBG FIGI, Country, Currency, Exchange, Exchange (fx) Rate, Market Currency, Sector` (+ `Coupon Rate`, `Maturity Date` for bond funds). |
| Distribution history | The **Export Data** CSV linked from the product page (`…/<TICKER>_Fund_Distributions.CSV`): ex-date, record/payable dates, income, capital gains, return of capital and **Total Distribution** per share (roughly a ten-year window, amounts as declared). Yahoo dividend events are the fallback. |
| Daily history, last market price, listing exchange fallback | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?period1=0&period2=…&interval=1d&events=div%7Csplit&includeAdjustedClose=true`). Adjusted closes drive the derived returns (QTD and every value the product page does not publish); raw close, adjusted close and volume rows are kept in paginated JSON. |
| Holdings fallback | SEC EDGAR Form **N-PORT-P** for the exact series: [`company_tickers_mf.json`](https://www.sec.gov/files/company_tickers_mf.json) maps the ticker to the Schwab Strategic Trust CIK plus series/class IDs, the series Atom feed resolves the newest non-amendment filing, the raw accession `.txt` payload carries the positions, and [`company_tickers.json`](https://www.sec.gov/files/company_tickers.json) restores exchange tickers for listed issuers. Used only when the issuer CSV is unavailable; the previous run is the last resort. |
| Catalog fallback | The previously published `api/schwab/index.json`, so a temporary issuer outage does not erase the static catalog. |
| Unused | `<TICKER>_NAV_History.CSV` (only the last ~6 months of NAVs) and the paginated `/allholdings/<TICKER>` HTML view (100 rows per page) — both documented, neither needed. |

Each fund carries a `metrics` object and a detailed `meta.json` that power the shared catalog/detail UI:

- `ytd`, `tr1y`, `cagr3y`, `cagr5y`, `cagr10y` and `siAnn` are the **official Schwab NAV total returns** from the product page's monthly table (YTD and 1 Year cumulative; 3/5/10 Year and Inception annualized), with Yahoo adjusted market-price closes as a transparent fallback for values the page does not publish (young funds);
- `tr3y`, `tr5y` and `tr10y` are cumulative returns computed as `(1 + CAGR nY)^n − 1` from the annualized source figures;
- `returns.monthEnd` carries `mo1` (official 1 Month), `mo3` (official 3 Month — a Schwab extension), `qtd` (derived from Yahoo adjusted closes; the page publishes 3-month, not quarter-to-date), YTD/1Y/3Y/5Y/10Y/SI plus `*Text` renderings; `returns.quarterEnd` is the product page's quarterly NAV table; the official **Market Price** rows are kept in `officialMarketPriceReturns`;
- `dividendYield` is the product page's **Distribution Yield (TTM)** when published, otherwise an explicitly labeled indicated yield (latest total distribution × inferred payments per year ÷ NAV); `meta.yields.dividendYieldKind` records which;
- `secYield` is the product page's **SEC Yield (30 Day)** when published (equity and bond funds alike); otherwise `—` with the reason in `meta.yields.secYieldKind`;
- `frequencyCode` (`01 - Monthly`, `04 - Quarterly`, `06 - Semi-annually`, `12 - Annually`, `00 - …`, `99 - Irregular`) is computed by the updater from the median ex-date gap of the official distribution history and written into `index.json`, so the **Frequency** column sorts numerically; the raw label stays in `distributions.frequency`;
- `returns.derivedFrom` and `metrics.returnsBasis` distinguish official NAV returns from the Yahoo adjusted-close fallback.

### Known coverage and freshness limitations

- **Market Value per holding is derived.** The issuer CSV publishes `Percent of Assets` but no value column, so the sheet's *Market Value* is `Percent of Assets × Total Net Assets` (the product page figure of the same day or the day before); `meta.holdings.marketValueBasis` says so. N-PORT-P fallback sheets carry the filed `valUSD` instead.
- **Holdings carry the BBG FIGI, not a CUSIP.** `Identifier` is the FIGI from the CSV (CUSIPs are only on the paginated HTML view). Bond rows keep `Ticker: "-"` because the CSV's `Symbol` column carries generic instrument labels for them (`TNOTE`, `T`, `WIT`, …); they are identified by FIGI so a Treasury note can never merge with a real equity ticker such as `T` (AT&T) in the Watchlist. Cash rows (`USD` / `US DOLLAR`) and futures are kept.
- **Close Price is Yahoo's last regular-session price.** The anonymous product page publishes a bid/ask midpoint and the premium/discount but no closing price; `meta.marketPrice.source` records the origin and the page's premium/discount (with its own as-of date) is preferred over the computed one.
- **Young funds publish `—`** for the periods they have not lived through (3/5/10 Year, sometimes 1 Year) and may lack a SEC yield or a TTM distribution yield (SGVT, SCCR, SMBS, SCUS); those cells render `—`, with the Yahoo-derived values only where the page publishes nothing at all.
- **Distributions are as declared, not split-adjusted.** SCHD (3-for-1) and SCHO (2-for-1) split on 2024-10-10; pre-split amounts are larger per share. The window is the issuer's (~10 years).
- **Inception date and ISIN.** Inception comes from the product finder/page; the ISIN is derived from the published CUSIP (`US` + CUSIP + check digit) and labelled `identifiers.isinBasis`.
- **Quarter-end YTD** is not published by Schwab (the quarterly table has 1/3/5/10 Year and Inception only) and stays `null`.
- **Freshness.** Holdings CSVs are dated files (usually the previous trading day); the product page NAV/premium are as of the last close; the Yahoo history ends at the last trading day; the product finder snapshot carries its own as-of date. Every block records its own as-of date in `meta.json`.
- **Issuer reachability.** schwabassetmanagement.com denies datacenter clients; the updater documents in `meta.source.productPageRendering` / `holdings.source` whether the direct page or the read-only rendering proxy supplied the data. A fund whose downloads fail transiently keeps its previous sheets with the previous source recorded, never a silently fresh-looking sheet.

### Update controls

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `MAX_FETCHES` | `0` / all | Batch size. A positive value continues after the committed ticker cursor in `api/schwab/update-state.json`; `0` is a full pass. |
| `REQUEST_SLEEP` | `1.5` | Minimum delay in seconds between request starts. Rendering-proxy requests are paced at ≥ 3.2 s (its anonymous tier is ~20 requests/minute) and HTTP 429 answers back off for 12 s+. |
| `CONCURRENCY` | `3` | Parallel fund workers. Request starts remain globally paced. |
| `AUM` | `:` | Total Net Assets range in dollars, `K/M/B/T` suffixes, or `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Expense-ratio range in percent, using strict `min:max` syntax. |
| `DIVIDEND_YIELD` | `:` | Distribution Yield (TTM) percentage range (indicated yield when the page publishes none). |
| `PERFORMANCE_YTD` … `PERFORMANCE_10Y` | unset | Annualized return ranges (official NAV returns where published). |
| `TOTAL_RETURN_YTD` … `TOTAL_RETURN_10Y` | unset | Cumulative return ranges. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, e.g. `SCHD SCHX SCHZ`. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each history JSON page. |
| `HISTORY_RANGE` | `max` | Yahoo chart range (`max`, `10y`, `5y`, …). |
| `STORE_RAW_DOWNLOADS` | off | Store the product finder and product pages (HTML or proxied markdown) under `api/schwab/raw`. CSV and SEC payloads are not committed. |
| `MAX_RETRIES` | `2` | Retries after the initial network/403/408/425/429/5xx request (the single direct issuer attempt is not retried). |
| `EDGAR_FALLBACK` | on | Set `0` to omit the SEC N-PORT-P holdings fallback. |
| `SKIP_SCHWAB` | off | Keep the previously generated catalog, product-page data, holdings and distributions; refresh Yahoo history only. |
| `SKIP_YAHOO` | off | Keep previously generated history rows when possible. |

### Full passes and resuming bounded runs

Running the updater without filters refreshes all catalog rows in alphabetical ticker order and resets the saved cursor after a full pass. A positive `MAX_FETCHES` is a resumable batch, not a permanent first-page limit: repeated runs continue after the committed cursor and wrap around the catalog. A filter run publishes only the eligible result set; an unfiltered run preserves prior rows for a fund that fails transiently. During every run, the updater prints one `[progress] n/total TICKER updated` or `[progress] n/total TICKER not updated` line as each fund finishes.

All range variables use `min:max`; both bounds are inclusive and optional, but the colon is required (`15:`, `:0.5`, `0.1:0.5`, `:`). AUM presets use the same sibling convention: nano (< $10M), micro ($10M–$300M), small ($300M–$2B), mid ($2B–$10B), large (>$10B).

### Examples

```bash
MAX_FETCHES=10 bun ./scripts/update-data.ts
TICKERS="SCHD SCHX SCHZ" bun ./scripts/update-data.ts
AUM="1B:" TER=":0.10" bun ./scripts/update-data.ts
PERFORMANCE_3Y="5:" bun ./scripts/update-data.ts
SKIP_YAHOO=1 bun ./scripts/update-data.ts
```

## Uploading N-PORT files in the browser

The header toolbar includes the same integrated drag-and-drop upload as `daggerok/iShares` and `daggerok/Fidelity`, N-PORT flavored: drop or pick a **Form N-PORT-P `primary_doc.xml`** (a Schwab Strategic Trust filing from EDGAR) and the app parses it entirely in your browser — no network — merging the fund and its holdings into the catalog, detail tabs and Watchlist. Uploads live for the current browser session only.

## Developer notes

- `scripts/update-data.ts` — Bun updater with no runtime dependencies: HTML/markdown line-model normalizer, product-finder and product-page parsers, holdings and distribution CSV readers, SEC fund/series resolver and raw N-PORT XML parser, Yahoo chart reader, derived metrics (`annualizedToTotal`, `priceReturns`, `inferDistributionFrequency`, `frequencyCodeLabel`, `isinFromCusip`), strict range parsers, bounded-run cursor, paced retries and deterministic paginated writes.
- `scripts/update-data.test.ts` — Bun tests with inline fixtures captured from the live issuer formats: range/AUM parsing, HTML and proxied-markdown catalog parsing, product-page parsing (both renderings, young-fund `--` cells), holdings CSVs (equity and bond flavours, derived market value, generic bond symbols), distribution CSV parsing, frequency inference and coding, ISIN derivation, Yahoo chart/return helpers, SEC mapping and raw N-PORT parsing.
- `scripts/check-index.ts` — Bun transpile check for the browser TypeScript (`app.tsx` through the same Babel pipeline the page uses), preventing a syntax error from leaving the published catalog on its loading screen.
- `scripts/ui-harness.ts` / `scripts/ui.test.ts` — headless acceptance suite for the UI contract (fake DOM + file-backed fetch over `api/schwab/`): per-tab sort/filter persistence, 1-click search clear, exact selection scopes, race-free holdings loading, Watchlist dedupe (FIGI-keyed bonds, `USD` cash rows) and chunked rendering. Run with `bun test`.
- `api/schwab/**` — generated static feed: `index.json`, `funds/{TICKER}/meta.json`, paginated `holdings/` and `history/` files, and `update-state.json`.
- `index.html` + `app.tsx` — the browser app (Tailwind CDN + Babel standalone, no build step), matching the sibling repositories' searchable catalog, persistent selection/blacklist, watchlist aggregation, detail tabs, exports and N-PORT upload workflow.
- The app keeps search and sort preferences in browser localStorage and reapplies them after reload. **Sort order is remembered per tab** (`schwab-tab-sorts`) and is **never reset by any button or checkbox**: sort All ETFs by *YTD Return*, round-trip through Watchlist or a fund detail tab, toggle select-all, search, blacklist, export, switch the theme or press **Clear** — the YTD Return order is still there. A tab that was never sorted keeps its default order (Watchlist: Weight Sum desc, Overview: Section asc, sheets: source order); **Clear** clears only the selection and the searches. To return to the default catalog order, click the *Ticker* header (asc).
- **Search filters are remembered per tab** (`schwab-tab-filters`, mirrored under `sheetFilter` in `schwab-site-state`): the search input is scoped to the active tab, switching tabs restores that tab's query (tabs without a filter show their full dataset), and the right-edge **✕** button (`#search-clear-btn`) clears the active tab's filter with one click. The last active tab also survives reload. Malformed stored values are sanitized at boot and can never crash the app.
- **Selection scopes are exact**: the row Use checkbox toggles one ETF; the header Use checkbox acts only on the rows currently rendered by the catalog table (catalog + active search filter + blacklist); the **All ETFs** pill checkbox acts on every non-blacklisted ETF in the whole catalog from any tab, without navigating. Every selection change immediately updates the subtitle ticker badges, the active fund, the detail-tab counts and the Watchlist label.
- **Watchlist aggregation is race-free and bounded**: `meta.json` requests dedupe per ticker, each ticker has one serialized holdings-page loader shared by the detail pager and the background loader (no duplicated or skipped pages), whole-catalog loading runs with 6 bounded workers, and the tab shows `Watchlist (Loading…)` → `Watchlist (N+)` → the exact deduplicated count. Dedupe keys fall back Ticker → CUSIP → ISIN → Identifier → SEDOL/FIGI → Name with namespaced keys; blank/`-`/`N/A` placeholders and the all-zero `000000000` CUSIP count as missing, and bond, cash, derivative and zero-weight rows are never dropped. The table renders in 250-row chunks that grow on scroll, while Copy Tickers / CSV / TXT always export the complete filtered result. The full contract is documented in [`docs/ui-contract.md`](./docs/ui-contract.md).
- Verification before publishing: `bun install --frozen-lockfile`, `bun test` (updater suite + UI contract acceptance suite), `bunx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --types bun,node --skipLibCheck scripts/update-data.ts scripts/update-data.test.ts`, `bun ./scripts/check-index.ts` and `git diff --check`. TypeScript 5.9.2 is pinned as a dev dependency only so that the type-check gate runs the same compiler everywhere; the site itself has no npm runtime dependency.

## TypeScript

The browser app is intentionally single-file: `index.html` loads `app.tsx` as TypeScript compiled in the browser with Babel standalone, following the `daggerok/youtube` no-src-files approach used by the sibling applications.

## Brands table

| Бренд                        | Фонды | Где брать данные |
|------------------------------|---|---|
| **Schwab** (33) ✅ | SCHD, SCHX, SCHG, SCHV, SCHB, SCHA, SCHM, SCHK, SCHF, SCHC, SCHE, SCHY, SCHH, FNDB, FNDX, FNDA, FNDF, FNDC, FNDE, STCE, SCHZ, SCHO, SCHR, SCHQ, SCHP, SCHI, SCHJ, SCYB, SCMB, SMBS, SCUS, SCCR, SGVT — весь каталог Schwab ETF | [schwabassetmanagement.com/products/{ticker}](https://www.schwabassetmanagement.com/products/schd) · каталог: [product-finder (ETFs)](https://www.schwabassetmanagement.com/product-finder?combine=&field_product_solution_target_id%5B0%5D=291&field_product_solution_target_id%5B1%5D=291) — весь каталог Schwab ETF уже интегрирован в наше приложение [daggerok/Schwab](https://github.com/daggerok/Schwab) |
| **Invesco** ✅ | QQQM, RSP, SPLV, SPHD, SPMO, SPHQ, SPGP, RPV, RPG, RWL, DBA, IDMO, IDHQ, IDLV (+ QQQ и весь каталог ~245 ETF) | [daggerok/Invesco](https://github.com/daggerok/Invesco) — весь каталог Invesco ETF |
| **SPDR / State Street** ✅ | SPYM, SPYG, SPYD, SDY, XLK, XLF… | [daggerok/SPDR](https://github.com/daggerok/SPDR) — весь каталог SSGA (179 фондов) |
| **iShares / BlackRock** ✅ | IVV, SGOV, DGRO, SOXX… | [daggerok/iShares](https://github.com/daggerok/iShares) — весь каталог, XLS-экспорт |
| **Amplify** ✅ | DIVO, IDVO, SILJ… | [daggerok/Amplify](https://github.com/daggerok/Amplify) — Firestore-фид данных |
| **Fidelity** ✅ | FTEC, FDVV, FDIS, FCOM + каталог Fidelity ETF | [daggerok/Fidelity](https://github.com/daggerok/Fidelity) — holdings из SEC EDGAR N-PORT |
| **WisdomTree** ✅ | USFR, DGRW, DHS, DON, EPI… | [daggerok/WisdomTree](https://github.com/daggerok/WisdomTree) — каталог + SEC EDGAR N-PORT |

## Brands list

#	Бренд	Фонды из списка (кол-во)	Официальный сайт / страницы фондов
1	Schwab — 33 ✅	SCHD, SCHX, SCHG, SCHV, SCHB, SCHA, SCHM, SCHK, SCHF, SCHC, SCHE, SCHY, SCHH, FNDB, FNDX, FNDA, FNDF, FNDC, FNDE, STCE, SCHZ, SCHO, SCHR, SCHQ, SCHP, SCHI, SCHJ, SCYB, SCMB, SMBS, SCUS, SCCR, SGVT	https://www.schwabassetmanagement.com/products/{ticker} (паттерн /products/{ticker} в нижнем регистре) · каталог: https://www.schwabassetmanagement.com/product-finder?combine=&field_product_solution_target_id%5B0%5D=291&field_product_solution_target_id%5B1%5D=291 — весь каталог Schwab ETF (33 фонда) уже интегрирован в наше приложение https://github.com/daggerok/Schwab
