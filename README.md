# Schwab

One of the app's features lets you select Schwab ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/schwab` static feed (Schwab Asset Management product finder, per-fund product pages, per-fund holdings and distribution CSV exports, Yahoo Finance daily history, SEC EDGAR N-PORT-P as holdings fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Schwab#main ./12345 && cd $_
bun install
bun run serve
open http://localhost:1234
```

Production build (Parcel into `dist`, `api/` copied to `dist/api`):

```bash
bun run build
bun run build-github-pages
```

```bash
# GitHub Pages is deployed by .github/workflows/github-pages.yml
```

The published application is available at <https://daggerok.github.io/Schwab/>.

### Column types and filters

Every column of the ETF catalog and of the Watchlist, Holdings, History and Distributions tabs has a type: text (`ABC`), number (`123`), percentage (`%`), money (`$`), date (`D`), date and time (`DT`) or time of day (`T`). The type is detected from the texts the column shows (80% of the filled cells must agree, otherwise text) and is written in the badge next to the column title: click it to cycle the type, Shift+click to return to auto-detection. Dates are read as `2024-06-15`, `6/15/2024`, `15.06.2024`, `Jun 15, 2024` or `15-Jun-2024`, date and time as `2024-06-15T09:30:00Z` or `2024-06-15 09:30`, time as `09:30`, `16:00:00` or `9:30 PM`

A row of filter inputs sits under the column headers (the `Filters` button hides it, `Clear filters` empties it). Filters of different columns are combined with AND, the search box applies on top, and Copy Tickers and the exports use the filtered rows. Filters and type overrides are remembered in the browser. `Sticky #` (next to `Filters`, off by default, remembered in the browser) numbers the rows by their rank in the table sorted by the current column before the column filters, so a filtered fund keeps its rank and the numbers keep gaps; the sort, the search and the category and blacklist choices rank again. The catalog starts sorted by Net Assets, largest first, unavailable values sort last in both directions, and every export starts with the `#` column. The red `Clear` button forgets everything saved in the browser without asking, except the blacklist and the theme, so the page looks like a first visit (also after a reload)

Inside one filter: a space means AND, a comma means OR, a leading `!` means NOT, `?` matches an empty or unavailable value and `!?` a value that is there; a value that is unavailable matches only `?` and negated conditions. An unquoted space ends the value, so quote values that contain one (`>="2024-06-15 09:30"`)

| Type | Examples |
| --- | --- |
| Text | `bank` contains, `"two words"`, `!bank`, `=exact`, `^starts`, `ends$`, `/regex/`, `tech, health` |
| Number, percentage, money | `>10`, `>=10 <50`, `=22` (matches what rounds to 22), `!=22`, `10..50`, `..50`, `10..`, `>1B` and `K` `M` `B` `T` suffixes, an optional `$` or `%` |
| Date, date and time | `>2024-06-01`, `2024` (the whole year), `2024-06` (the whole month), `2024-01..2024-06`, `today`, `yesterday`, `-7d..` (the last 7 days), `+2w`, `-3m`, `-1y` |
| Time | `>09:30`, `09:30..16:00`, `=12:00` (the whole minute) |

The `Columns` menu next to `Filters` lists every column of the ETF table from the first to the last, all of them shown by default, with a search box and the `All`, `Clear`, `Toggle` and `Reset` buttons. `Use` and `Ticker` are listed but locked. Hiding a column only removes it from the table: the filters, the sorting, the exports and Copy Tickers still use it. The choice is remembered in the browser (localStorage, never the data) and the menu is shown on the ETF catalog only

The asset classes are one `Asset classes` multi-select next to the `All ETFs` pill instead of one tab per class: every class is selected by default (= all ETFs), `Only` or unchecking narrows the table, and the `All ETFs` pill is lit only while nothing narrows it (all or none of the classes checked); clicking the pill clears the selection. The choice is remembered in the browser (localStorage, never the data)

## Updating the static Schwab data

Run the updater with Bun:

```bash
bun test
./scripts/update-data.ts
```

Run `./scripts/update-data.ts -h` (or `--help`) to print every configuration variable with its default and usage examples.

Defaults live in `scripts/update-data.config.json` (every control as a string). An explicitly set environment variable overrides the file, even when it is empty. The **Update Schwab ETF data** GitHub Actions workflow uses the same resolver (`resolveControls` in `scripts/update-data.ts`): individual `workflow_dispatch` inputs are blank by default and inherit the file, and the `advanced` input accepts a JSON object with any control (for example `{"VERBOSE":"true"}`). Precedence: file defaults < advanced JSON < nonblank inputs < protected Actions variable or environment. GitHub allows at most 25 inputs, so `STORE_RAW_DOWNLOADS`, `VERBOSE`, `SEC_UA` and `TOTAL_RETURN_10Y` are set through `advanced`, and `SEC_UA` is also taken from the protected `SEC_UA` repository Actions variable when it is nonblank. The workflow always writes to `api/schwab` only. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Schwab ETFs) | `https://www.schwabassetmanagement.com/product-finder` (Schwab product finder page) |
| Holdings per fund | `https://www.schwabassetmanagement.com/products/{TICKER}` -> holdings CSV export (e.g. [SCHD](https://www.schwabassetmanagement.com/products/schd)) |
| Daily history, distributions | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?range=max&interval=1d&events=div`) |
| Fallback | SEC EDGAR N-PORT-P for holdings fallback |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*; derived only when the history spans at least one year
- `dividendYield` - 12-month trailing yield or indicated yield (latest distribution x frequency / price), an estimate when derived from market price
- `dividendYieldBasis` - short code for the definition behind `dividendYield`, `null` exactly when `dividendYield` is `null`:

  | Code | Meaning for Schwab |
  | --- | --- |
  | `official-trailing-12m` | the `Distribution Yield (TTM)` published on the official product page (also when a missing page section keeps the previously published value) |
  | `indicated` | updater estimate: latest distribution x inferred payments per year / NAV or price, used when the page publishes no yield |
  | `official-other` | a yield carried over from an older index row whose origin was not recorded |
  | `official-distribution-rate`, `computed-trailing-12m` | not produced for this brand |

- `secYield` - 30-day SEC yield when published; `-` otherwise
- `returnsBasis` - mandatory non-empty text saying how the returns were computed: official Schwab product-page NAV total returns (month-end) with Yahoo adjusted closes filling gaps, or adjusted market-price closes from Yahoo only (an estimate, not official NAV)
- `performanceAsOf` - mandatory ISO `YYYY-MM-DD` date the returns are as of: the product-page performance table date, or the last Yahoo close date when derived; not the NAV date, `null` only when truly unknown

Caveats:

- Returns published on the Schwab product page are official NAV figures; values derived from Yahoo Finance daily history are market-price estimates
- Unavailable values stay empty and are never written as `0` (an unavailable holdings weight is `-`)
- QTD is measured from the last close before the quarter began, so it is `null` until a prior quarter-end close exists
- A fund is either fully updated or kept as published: when the product page or the Yahoo chart fails for an already published fund, its previous complete data stays (the workflow still commits what other funds updated); the run stops taking new funds after 25 minutes and still writes the index; files are written through a temporary file and rename, stale pages are removed after the new `meta.json` is written
- A product page counts as fully loaded only when it has Quote Details (Premium/Discount and Bid/Ask Midpoint rows), the Fund Profile table (NAV and Total Net Assets rows) and both performance tables (a Monthly and a Quarterly block). The rendering proxy sometimes returns a partial page: every section that was published as official before (quote details, fund profile, yields, month-end returns, quarter-end returns) and is missing from such a page counts as a failed read of that section. The previous official block is kept as one unit (values with their as-of dates, `returnsBasis` and `performanceAsOf`), never replaced by Yahoo-derived values, a computed premium or `null`, and one `[ kept ]` line per fund names what was kept. A fully loaded page that lacks a field is an honest absence and publishes `null`. The market price is always the labelled Yahoo last price because the anonymous page publishes none
- A catalog fund with no published data whose page or chart read failed is not written at all; `index.json` still lists it with `dataFile: null` and a full all-`null` `metrics` object (`returnsBasis` says no data was published yet). When the product finder fails in a run, the published gross expense ratio is kept
- Dates printed as `Mon DD YYYY` (zero-padded); month-name dates are parsed as UTC so local runs match CI
- `NEW FUNDS: ...` is printed (and added to the step summary) when the live catalog lists tickers that are not yet published
- Each fund keeps as-of date and source metadata for holdings and history
- Holdings come from the dated Schwab CSV export; SEC EDGAR N-PORT-P is used only when the CSV is unavailable and `EDGAR_FALLBACK` is on, and the previous run is the last resort
- Issuer requests go direct first and fall back to the read-only r.jina.ai rendering proxy (paced at 3.2s or slower) when the site answers with a bot wall

### Update controls

Keep this table, `scripts/update-data.config.json`, `CONTROL_NAMES` and `--help` in sync

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` (all) | Batch size: with a positive value the updater continues after the committed cursor in `api/schwab/update-state.json`, wraps around after the last fund and counts only funds that pass the catalog-level filters (`TICKERS`, `TER`); the cursor is scoped to the filter set and a `TICKERS` run never reads or writes it; empty or `0` is a full pass - every fund is refreshed in one run |
| `REQUEST_SLEEP` | `2` | Minimum delay in seconds between outgoing request starts, including retries |
| `CONCURRENCY` | `2` | Number of parallel fund update workers; request starts are still globally spaced by `REQUEST_SLEEP` |
| `AUM` | `:` | Net Assets range; each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large` |
| `TER` | `:` | Expense ratio range in % (strict `min:max`) |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range |
| `SEC_YIELD` | `:` | 30-day SEC yield percentage range (`min:max`); funds without a published SEC yield do not match an active range |
| `TICKERS` | empty (all) | Space-, comma- or semicolon-separated ticker allowlist, e.g. `SCHB SCHX SCHG SCHV SCHD`; an invalid entry or a ticker unknown to the catalog is an error |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page |
| `STORE_RAW_DOWNLOADS` | `false` | Store the official product finder and product pages under `api/schwab/raw` |
| `MAX_RETRIES` | `2` | Integer >= 1; retries after the initial request; only network errors, timeouts (every request has a 45 s timeout covering headers and body) and HTTP 408/425/429/5xx are retried with exponential backoff; requests through the rendering proxy are retried at most once |
| `HISTORY_RANGE` | `max` | Yahoo history window: `max` or `Ny` (for example `5y`); applied as an explicit `period1`/`period2` request window, anything else is an error |
| `EDGAR_FALLBACK` | `true` | Use SEC EDGAR Form N-PORT-P when the issuer holdings CSV is unavailable |
| `SKIP_YAHOO` | `false` | Keep previous history and distributions while refreshing catalog and holdings |
| `SKIP_SCHWAB` | `false` | Keep the previously published catalog, product-page data, holdings and distributions |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent override; SEC policy requires automated tools to declare a contact; the protected `SEC_UA` Actions variable wins when nonblank |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |
| `PERFORMANCE_YTD`, `_1Y`, `_3Y`, `_5Y`, `_10Y` | `:` | Annualized return ranges (`min:max`); YTD and 1Y are the official returns where published; a bounded range excludes funds with no value for that tenor |
| `TOTAL_RETURN_YTD`, `_1Y`, `_3Y`, `_5Y`, `_10Y` | `:` | Cumulative return ranges (`min:max`) |

`TICKERS` combines with the AUM, TER and yield filters using AND logic; it does not override them. Filtered or bounded runs (`TICKERS`, `MAX_FETCHES`, any range filter, `SKIP_SCHWAB`, `SKIP_YAHOO`) never shrink the feed: funds that are not selected, are skipped by a filter or fail keep their published row and data files, and `api/schwab/index.json` always lists every fund known from the previous index or `funds/*/meta.json`, even one missing from the live catalog

### Examples

```bash
MAX_FETCHES=10 ./scripts/update-data.ts
TICKERS="SCHB SCHX SCHG SCHV SCHD" ./scripts/update-data.ts
AUM="1B:" TER=":0.5" SEC_YIELD="3:" ./scripts/update-data.ts
PERFORMANCE_1Y="15:" ./scripts/update-data.ts
```

## TypeScript and verification

The browser app lives in `src/` (`index.html`, `main.tsx`, `index.css` with Tailwind v4) and is built by Parcel into `dist` (`bun run build`); `src/main.tsx` is plain TypeScript with no `tsconfig.json` needed. Bun runs the updater TypeScript out of the box. GitHub Pages is deployed by `.github/workflows/github-pages.yml`

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` also covers the README controls table, the config file, `--help` and the workflow.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as all sibling ETF repositories.](./LICENSE)

Schwab® and Schwab ETFs® and the fund names/tickers referenced here are trademarks of Charles Schwab & Co., Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Schwab Asset Management (Charles Schwab Investment Management, Inc.) or Charles Schwab & Co., Inc. All data is reproduced from Schwab Asset Management's own public product pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
