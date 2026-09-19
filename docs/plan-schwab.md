# Schwab static data plan (S0 research)

Brand slug: display **Schwab**, storage/feed prefix **`schwab`** (`api/schwab/**`,
`schwab-*` localStorage keys), repository `daggerok/Schwab`, published at
<https://daggerok.github.io/Schwab/>.

This document records the live research done before implementation (all
endpoints were verified on 2026-09-19) and lists, for every catalog/overview
metric, the exact source or the documented gap. The application itself is a
byte-for-byte structural sibling of `daggerok/Invesco` (primary template),
`daggerok/Fidelity` (co-template) and `daggerok/WisdomTree` (mechanism
reference: per-tab sort/filter memory, race-free Watchlist loading, headless
UI acceptance suite); only the data source, the fund universe, the
source-naming tooltips, the subtitle sentence and the documented data gaps
differ.

## 1. Issuer surface (verified live)

| Endpoint | Purpose | Verified shape |
| --- | --- | --- |
| `https://www.schwabassetmanagement.com/product-finder?combine=&field_product_solution_target_id%5B0%5D=291&field_product_solution_target_id%5B1%5D=291` | Official ETF catalog (product finder filtered to ETFs) | 33 ETFs (`33 of 33 showing`, catalog as-of `08/27/26`): ticker + fund name (link to `/products/<ticker>`), Product Type, Asset Class (`Fixed Income`, `International Equities`, `Global Equities`, `Money Market`, `Real Estate`, `U.S. Equities`), Gross Expense Ratio (blank for some U.S. equity rows), Net Expense Ratio, Inception Date (`MM/DD/YY`) |
| `https://www.schwabassetmanagement.com/products/<ticker>` | Official product page | Fund Profile table: Fund Inception, Total Net Assets (as of), Total Expense Ratio, Index Name, Shares Outstanding, NAV (as of), Total Holdings (as of), Portfolio Turnover Rate, Morningstar Category, Management Style, CUSIP, Exchange. Yields table: SEC Yield (30 Day), Distribution Yield (TTM), (bond funds) Average Yield to Maturity. Quote Details: Bid/Ask Midpoint, Premium/Discount, 30-Day Median Bid/Ask Spread, Today's Volume. Performance: `<TICKER> NAV` and `<TICKER> Market Price` rows — Monthly block (1 Month, 3 Month, YTD cumulative; 1/3/5/10 Year and Inception annualized, month-end as-of) and Quarterly block (1/3/5/10 Year, Inception annualized, quarter-end as-of). Portfolio: Top Holdings (as-of date + `Export All Holdings` link + `View All Holdings` link), Sectors / Security Types, Asset Allocation. Distributions: `Export Data` link + per-ex-date list |
| `https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/<TICKER>/<TICKER>_FundHoldings_<YYYY-MM-DD>.CSV` | Full holdings CSV (dated file name, discovered from the product page `Export All Holdings` link) | Equity flavour header: `As-Of-Date,Symbol,Quantity,Percent of Assets,Name,BBG FIGI,Country,Currency,Exchange,Exchange (fx) Rate,Market Currency,Sector`; bond flavour adds `Coupon Rate` and `Maturity Date`. Cash rows publish `Symbol=USD`, `Name=US DOLLAR`. Bond rows publish generic symbols (`TNOTE`, `T`, `WIT`, …) that are **not** exchange tickers. No CUSIP and no market value column. Trailer: quoted disclaimer lines |
| `https://www.schwabassetmanagement.com/allholdings/<TICKER>` | HTML holdings view | Same data plus CUSIP and rounded market value, paginated 100 rows per page — not used (would cost ~400 requests per pass) |
| `https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/<TICKER>/<TICKER>_Fund_Distributions.CSV` | Official distribution history | Header: `Ex-Date,Record Date,Payable Date,Income,Short-Term Capital Gain,Long-Term Capital Gain,Return Of Capital,Total Distribution`; roughly a ten-year window; amounts are as declared (not split-adjusted); `--` placeholders |
| `https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/<TICKER>/<TICKER>_NAV_History.CSV` | Daily NAV | `Date,Fund NAV`, only the last ~6 months — documented, not used for the History tab |
| `https://query1.finance.yahoo.com/v8/finance/chart/<TICKER>?period1=0&period2=…&interval=1d&events=div%7Csplit&includeAdjustedClose=true` | Daily history + dividends + splits | Same public chart endpoint as every sibling feed |
| `https://www.sec.gov/files/company_tickers_mf.json` → `browse-edgar?action=getcompany&CIK=<seriesId>&type=NPORT-P&output=atom` → `Archives/edgar/data/<cik>/<acc>/<accession>.txt` | SEC EDGAR Form N-PORT-P holdings fallback (Schwab Strategic Trust, CIK 1454889) | Same resolver as `daggerok/WisdomTree`; used only when the issuer CSV is unavailable |

Connectivity note (verified in GitHub Actions on 2026-09-19): the issuer CDN
answers every request from the Actions network with HTTP 403 `Access Denied`
regardless of User-Agent, while the read-only `r.jina.ai` rendering of the same
public URLs (product finder, product pages, CSV exports) returns them intact
(the CSV files verbatim under its `Markdown Content:` preamble). The proxy is
itself behind Cloudflare and challenges browser User-Agents, so proxy requests
declare the plain feed User-Agent. The updater therefore makes one direct
browser-like attempt per document, switches to the proxy after two denials in a
run, and records the rendering that supplied each block in `meta.json`
(`source.productPageRendering`, `holdings.source`, `distributions.source`).
Yahoo and SEC requests stay direct (both answered HTTP 200 from Actions).

## 2. Metric → source table

| Catalog / Overview metric | Source | Notes |
| --- | --- | --- |
| Ticker, Fund Name | product finder (name refined by the product page title) | 33 funds |
| Type (Asset Class tab) | product finder `Asset Class` | six categories |
| NAV | product page `NAV` (+ as-of) | Yahoo last close is the fallback |
| Net Assets | product page `Total Net Assets` (+ as-of) | dollars, exact |
| Expense | product finder `Net Expense Ratio` / product page `Total Expense Ratio` | gross kept in `meta.expenseRatio.gross` |
| Dividend Yield | product page `Distribution Yield (TTM)` | published TTM; indicated yield only when absent (recorded in `yields.dividendYieldKind`) |
| SEC Yield | product page `SEC Yield (30 Day)` | published for equity and bond funds; `—` when the page omits it (e.g. very young funds) |
| Frequency | coded cadence (`01 - Monthly`, `04 - Quarterly`, `06 - Semi-annually`, `12 - Annually`, `00 - …`, `99 - Irregular`) computed by the updater from the official distribution ex-dates and written as `frequencyCode` into `index.json` | Yahoo dividends are the fallback |
| YTD Return, TR 1Y | product page **NAV total returns**, monthly block (YTD cumulative, 1 Year annualized = cumulative) | Yahoo adjusted-close fallback |
| CAGR 3Y/5Y/10Y, SI Ann. Return | product page NAV total returns, monthly block (3/5/10 Year, Inception annualized) | Yahoo fallback |
| TR 3Y/5Y/10Y | `(1 + CAGR nY)^n − 1` from the annualized figures | same derivation as Invesco/WisdomTree |
| As Of | product page NAV as-of date | |
| Inception | product finder / product page `Fund Inception` | |
| Holdings | rows of the holdings CSV | N-PORT-P fallback |
| History | rows of the Yahoo chart | |
| History As Of | last Yahoo trading day | |
| Close Price / Premium-Discount | Yahoo last close (market price) / product page `Premium/Discount` | product page publishes no close value for anonymous visitors |
| CUSIP / ISIN / Benchmark | product page `CUSIP` / ISIN derived from the CUSIP (`US` + CUSIP + check digit, labelled derived) / product page `Index Name` | |
| Exchange | product page `Exchange` | |
| Distributions tab | official distributions CSV (`Ex-Date`, `Amount` = Total Distribution) | Yahoo dividends fallback |
| Holdings sheet columns | `Name`, `Ticker`, `Identifier` (BBG FIGI), `Weight`, `Market Value`, `Shares Held`, `Asset Category` (+ `Coupon`, `Maturity` for bond funds) | Market Value is **derived** = Percent of Assets × Total Net Assets (labelled in `meta.holdings.marketValueBasis`) |

## 3. Documented gaps (`—` cells)

- **Market Value** is not in the issuer CSV; the sheet carries a derived value
  (weight × total net assets) and the manifest says so.
- **CUSIP per holding** is only on the paginated HTML view; the feed uses the
  BBG FIGI as `Identifier`. Bond rows keep `Ticker: "-"` (their CSV symbols
  are generic instrument labels such as `TNOTE`/`T`/`WIT`) so the Watchlist
  dedupes them by FIGI, never against real exchange tickers.
- **Close Price** is Yahoo's last close (the anonymous product page shows
  `--` for the previous close).
- **SEC Yield / Distribution Yield / returns** are `—` for funds younger than
  the period or when the page omits them (young funds such as SGVT, SCCR).
- **Distributions** cover the issuer's published window (~10 years) with
  amounts as declared (not split-adjusted; SCHD 3-for-1 and SCHO 2-for-1
  splits on 2024-10-10).
- **Quarter-end returns** come from the product page quarterly block (NAV);
  `mo1` is the official 1-month figure, `qtd` is derived from Yahoo adjusted
  closes (the page publishes 3-month, not quarter-to-date).

## 4. Live results (first full pass, GitHub Actions run 35432545495)

- 33 funds / 52,495 holdings rows / 94,523 history rows (`api/schwab/index.json`
  `generatedAt 2026-09-19T08:44:30Z`), every fund with NAV, Total Net Assets,
  TER, CUSIP (+ derived ISIN), exchange, official month-end and quarter-end NAV
  returns, SEC Yield (30 Day), Distribution Yield (TTM), premium/discount,
  official distribution history and a coded frequency.
- `—` cells, all period-based and all because the fund is younger than the
  period (official table publishes `--`, Yahoo cannot compute either):
  - CAGR 3Y / TR 3Y: SCCR, SCUS, SGVT, SMBS;
  - CAGR 5Y / TR 5Y: SCCR, SCMB, SCUS, SCYB, SGVT, SMBS, STCE;
  - CAGR 10Y / TR 10Y: SCCR, SCHI, SCHJ, SCHK, SCHQ, SCHY, SCMB, SCUS, SCYB,
    SGVT, SMBS, STCE.
- Quarter-end YTD is `null` for every fund (not published in the quarterly
  table); `mo3` (official 3 Month) is an extra field.
- Frequencies inferred from the official ex-dates: Monthly for the bond and
  money-market funds, Quarterly for the U.S. equity funds and SCHY/SCHH,
  Semi-annually for the international equity funds and STCE.

## 5. Stages

S1 skeleton · S2 `index.html` · S3 `app.tsx` · S4 UI harness + acceptance
suite · S5 `scripts/update-data.ts` · S6 updater tests · S7 workflow + README
+ docs · S8 feed generation (GitHub Actions — the build sandbox has no egress
to Schwab/Yahoo/SEC) · S9 acceptance suite against the real feed · S10 gate ·
S11 E2E · S12 report.
