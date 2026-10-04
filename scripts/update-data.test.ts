// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  CONTROL_NAMES,
  FETCH_TIMEOUT_MS,
  annualizedToTotal,
  cleanHoldingTicker,
  configurePacing,
  deriveMetrics,
  distributionsCsvUrl,
  fetchText,
  firstDate,
  firstNumber,
  frequencyCodeLabel,
  historyPeriodStart,
  holdingsCsvCandidates,
  htmlToText,
  inferDistributionFrequency,
  installSystemCa,
  isCertError,
  isDistributionsCsv,
  isHoldingsCsv,
  isProductPage,
  isinFromCusip,
  lookupLabel,
  main,
  mergeOfficialReturns,
  normalizeHoldingName,
  nportUrlFor,
  numberOrNull,
  paceRequests,
  parseAumRange,
  parseCatalogText,
  parseChart,
  parseCsv,
  parseDistributionsCsv,
  parseEdgarAtomFilings,
  parseFundName,
  parseFundTickerMap,
  parseHoldingsCsv,
  parseNport,
  parseOfficialReturns,
  parseProductPage,
  placeholderRow,
  parseRange,
  parseRanges,
  performanceAsOf,
  postFetchFilterReasons,
  priceReturns,
  proxyUrl,
  readConfig,
  readMissingRows,
  resolveControls,
  rowFromMeta,
  runtimeControls,
  softDeadlineReached,
  stripProxyPreamble,
  toIsoDate,
  toTextLines,
  useApiRoot,
} from './update-data';

// ---------------------------------------------------------------------------
// Isolation: clean env, pinned time zone, restored globals (see .claude/rules/etf-tests.md)
// ---------------------------------------------------------------------------

const ENV_KEYS = [...CONTROL_NAMES, 'GITHUB_STEP_SUMMARY', 'TZ'];
let savedEnv: Record<string, string | undefined> = {};
let savedFetch: typeof fetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  savedFetch = globalThis.fetch;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.TZ = 'UTC';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = savedFetch;
  process.exitCode = 0; // main() sets 1 when every selected fund failed; it must not leak into `bun test`
});


// ---------------------------------------------------------------------------
// Fixtures: verbatim shapes observed on schwabassetmanagement.com (2026-09-19)
// ---------------------------------------------------------------------------

const PRODUCT_FINDER_MARKDOWN = [
  'Title: Our investment products | Schwab Asset Management',
  '',
  'URL Source: https://www.schwabassetmanagement.com/product-finder?combine=&field_product_solution_target_id%5B0%5D=291',
  '',
  'Markdown Content:',
  '# Our investment products',
  '',
  ' 33 of 33 showing ',
  '',
  '*   ### [SCHJ Schwab 1-5 Year Corporate Bond ETF](https://www.schwabassetmanagement.com/products/schj)',
  '',
  'Fund Data Product Type ETFs Asset Class Fixed Income',
  'As of 08/27/26',
  '',
  'Gross Expense Ratio 0.030%Net Expense Ratio*0.030%Inception Date 10/10/19  ',
  '*   ### [SCHK Schwab 1000 Index® ETF](https://www.schwabassetmanagement.com/products/schk)',
  '',
  'Fund Data Product Type ETFs Asset Class U.S. Equities',
  'As of 08/27/26',
  '',
  'Net Expense Ratio*0.030%Inception Date 10/11/17  ',
  '',
  '| Fund | Product Type | Asset Class | Gross Expense Ratio | Net Expense Ratio* | Inception Date |  |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| [SCHJ Schwab 1-5 Year Corporate Bond ETF](https://www.schwabassetmanagement.com/products/schj) | ETFs | Fixed Income | 0.030% | 0.030% | 10/10/19 | [Save](https://www.schwabassetmanagement.com/product-finder#) |',
  '| [STCE Schwab Crypto Thematic Natural Language Processing ETF (formerly known as Schwab Crypto Thematic ETF)](https://www.schwabassetmanagement.com/products/stce) | ETFs | Global Equities | 0.300% | 0.300% | 08/04/22 | [Save](https://www.schwabassetmanagement.com/product-finder#) |',
  '| [SGVT Schwab® Government Money Market ETF](https://www.schwabassetmanagement.com/products/sgvt) | ETFs | Money Market | 0.280% | 0.280% | 06/12/25 | [Save](https://www.schwabassetmanagement.com/product-finder#) |',
  '| [SCHK Schwab 1000 Index® ETF](https://www.schwabassetmanagement.com/products/schk) | ETFs | U.S. Equities |  | 0.030% | 10/11/17 | [Save](https://www.schwabassetmanagement.com/product-finder#) |',
  '| [SCHD Schwab U.S. Dividend Equity ETF](https://www.schwabassetmanagement.com/products/schd) | ETFs | U.S. Equities |  | 0.060% | 10/20/11 | [Save](https://www.schwabassetmanagement.com/product-finder#) |',
  '',
  '[ETF education](https://www.schwabassetmanagement.com/resources/etf-knowhow)',
  '[Mutual funds](https://www.schwabassetmanagement.com/products/mutual-funds)',
].join('\n');

const PRODUCT_FINDER_HTML = `<!DOCTYPE html><html><head><title>Our investment products | Schwab Asset Management</title>
<script>window.drupalSettings = {"a":1};</script><style>.x{color:red}</style></head>
<body><nav><a href="/products/etfs">ETFs</a><a href="/products/mutual-funds">Mutual Funds</a></nav>
<div class="view-header"> 33 of 33 showing </div><p>As of 08/27/26</p>
<table class="views-table"><thead><tr><th>Fund</th><th>Product Type</th><th>Asset Class</th><th>Gross Expense Ratio</th><th>Net Expense Ratio*</th><th>Inception Date</th><th></th></tr></thead>
<tbody>
<tr><td><a href="/products/schr">SCHR<br><br> Schwab Intermediate-Term U.S. Treasury ETF</a></td><td>ETFs</td><td>Fixed Income</td><td>0.030%</td><td>0.030%</td><td>08/05/10</td><td><a href="#">Save</a></td></tr>
<tr><td><a href="/products/schx">SCHX<br><br> Schwab U.S. Large-Cap ETF</a></td><td>ETFs</td><td>U.S. Equities</td><td></td><td>0.030%</td><td>11/03/09</td><td><a href="#">Save</a></td></tr>
<tr><td><a href="/products/fnde">FNDE<br><br> Schwab Fundamental Emerging Markets Equity ETF</a></td><td>ETFs</td><td>International Equities</td><td>0.390%</td><td>0.390%</td><td>08/15/13</td><td><a href="#">Save</a></td></tr>
</tbody></table></body></html>`;

const PRODUCT_PAGE_MARKDOWN = [
  'Title: SCHO Schwab Short-Term U.S. Treasury ETF | Schwab Asset Management',
  '',
  'URL Source: https://www.schwabassetmanagement.com/products/scho',
  '',
  'Markdown Content:',
  '# Schwab Short-Term U.S. Treasury ETF',
  '',
  'Type: ETFs Symbol: SCHO Total Expense Ratio: 0.030%',
  '',
  '## Schwab Market Talk',
  '',
  'Quote Details',
  '',
  '*    Today\'s Volume   1,234,567   As of 09/18/2026',
  '*    Bid/Ask Midpoint   $23.91   As of 09/18/2026',
  '*    Premium/Discount   -0.01%   As of 09/18/2026',
  '',
  '[NAV History Download](https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_NAV_History.CSV)',
  '',
  '## Fund Details',
  '',
  '### Fund Profile',
  '',
  '*   ### **Fund Inception**',
  '',
  'Fund Data 08/05/2010 ',
  '*   ### **Total Net Assets (as of 09/17/2026)**',
  '',
  'Fund Data $15,193,857,213.48 ',
  '',
  '|  |  |  |',
  '| --- | --- | --- |',
  '| **Fund Inception** |  | 08/05/2010 |',
  '| **Total Net Assets** As of 09/17/2026 | 09/17/2026 | $15,193,857,213.48 |',
  '| **Total Expense Ratio** |  | 0.030% |',
  '| **Index Name** |  | Bloomberg US Treasury 1-3 Year Index |',
  '| **Shares Outstanding** As of 09/18/2026 | 09/18/2026 | 635,570,000 |',
  '| **NAV** As of 09/18/2026 | 09/18/2026 | $23.91 |',
  '| **Total Holdings** As of 09/17/2026 | 09/17/2026 | 96 |',
  '| **Portfolio Turnover Rate** As of 08/31/2026 | 08/31/2026 | 63% |',
  '| **Morningstar Category** |  | Short Government |',
  '| **Management Style** |  | Passive |',
  '| **CUSIP** |  | 808524805 |',
  '| **Exchange** |  | NYSE Arca, Inc. |',
  '',
  '### Yields',
  '',
  '|  |  |  |  |',
  '| --- | --- | --- | --- |',
  '| **SEC Yield (30 Day)** As of 09/17/2026 | 09/17/2026 | 3.62% |',
  '| **Distribution Yield (TTM)** As of 08/31/2026 | 08/31/2026 | 3.91% |',
  '| **Average Yield to Maturity** As of 06/30/2026 | 06/30/2026 | 3.55% |',
  '',
  '## Performance',
  '',
  '### Monthly',
  '',
  ' 08/31/2026',
  '',
  '*   ### **SCHO NAV**',
  '',
  'Fund Data Cumulative Returns (%)',
  '',
  '1 Month+0.25 3 Month+0.43 YTD+1.04 ',
  '',
  'Annualized Returns (%)',
  '',
  '1 Year+2.47 3 Year+4.23 5 Year+1.92 10 Year+1.77 Inception+1.37 ',
  '',
  '| Description |  | Cumulative Returns (%) |  |  | Annualized Returns (%) |  |  |  |  |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 Month | 3 Month | YTD | 1 Year | 3 Year | 5 Year | 10 Year | Inception |',
  '| **SCHO Market Price** |  | +0.21 | +0.43 | +1.00 | +2.44 | +4.21 | +1.91 | +1.76 | +1.36 |',
  '| **SCHO NAV** |  | +0.25 | +0.43 | +1.04 | +2.47 | +4.23 | +1.92 | +1.77 | +1.37 |',
  '| **Bloomberg US Treasury 1-3 Year Index** |  | +0.26 | +0.45 | +1.08 | +2.52 | +4.28 | +1.98 | +1.83 | +1.44 |',
  '',
  '### Quarterly',
  '',
  ' 06/30/2026',
  '',
  '| Description |  | Annualized Returns (%) |  |  |  |  |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| 1 Year | 3 Year | 5 Year | 10 Year | Inception |',
  '| **SCHO Market Price** |  | +2.11 | +3.98 | +1.60 | +1.70 | +1.33 |',
  '| **SCHO NAV** |  | +2.14 | +4.00 | +1.61 | +1.71 | +1.34 |',
  '',
  '## Portfolio',
  '',
  '### Top Holdings',
  '',
  'As of 09/17/2026[Export All Holdings](https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_FundHoldings_2026-09-17.CSV)[View All Holdings](https://www.schwabassetmanagement.com/allholdings/SCHO)',
  '',
  '## Distributions',
  '',
  '[Export Data](https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_Fund_Distributions.CSV)',
].join('\n');

const PRODUCT_PAGE_HTML = `<html><head><title>SCHD Schwab U.S. Dividend Equity ETF | Schwab Asset Management</title></head><body>
<h1>SCHD Schwab U.S. Dividend Equity ETF</h1>
<ul><li><span>Bid/Ask Midpoint</span><span>$33.88</span><span>As of 09/18/2026</span></li>
<li><span>Premium/Discount</span><span>0.03%</span><span>As of 09/18/2026</span></li></ul>
<table><tr><th>Fund Inception</th><td>10/20/2011</td></tr>
<tr><th>Total Net Assets (as of 09/17/2026)</th><td>$112,770,927,091.11</td></tr>
<tr><th>Total Expense Ratio</th><td>0.060%</td></tr>
<tr><th>Index Name</th><td>Dow Jones U.S. Dividend 100&trade; Index</td></tr>
<tr><th>NAV (as of 09/18/2026)</th><td>$33.66</td></tr>
<tr><th>Total Holdings (as of 09/17/2026)</th><td>102</td></tr>
<tr><th>Morningstar Category</th><td>Large Value</td></tr>
<tr><th>CUSIP</th><td>808524797</td></tr>
<tr><th>Exchange</th><td>NYSE Arca, Inc.</td></tr></table>
<table><tr><th>SEC Yield (30 Day)</th><td>3.25%</td><td>09/17/2026</td></tr>
<tr><th>Distribution Yield (TTM)</th><td>3.00%</td><td>08/31/2026</td></tr></table>
<h3>Monthly</h3><p>08/31/2026</p>
<table><tr><th>Description</th><th>1 Month</th><th>3 Month</th><th>YTD</th><th>1 Year</th><th>3 Year</th><th>5 Year</th><th>10 Year</th><th>Inception</th></tr>
<tr><td>SCHD Market Price</td><td>+4.24</td><td>+8.21</td><td>+29.29</td><td>+29.53</td><td>+16.19</td><td>+10.01</td><td>+13.17</td><td>+13.66</td></tr>
<tr><td>SCHD NAV</td><td>+4.28</td><td>+8.24</td><td>+29.31</td><td>+29.56</td><td>+16.21</td><td>+10.02</td><td>+13.18</td><td>+13.67</td></tr></table>
<h3>Quarterly</h3><p>06/30/2026</p>
<table><tr><td>SCHD NAV</td><td>+24.03</td><td>+13.52</td><td>+8.51</td><td>+12.37</td><td>+13.09</td></tr></table>
<p>As of 09/17/2026 <a href="/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_FundHoldings_2026-09-17.CSV">Export All Holdings</a>
<a href="/allholdings/SCHD">View All Holdings</a></p>
<a href="/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_Fund_Distributions.CSV">Export Data</a>
</body></html>`;

const EQUITY_HOLDINGS_CSV = [
  'As-Of-Date,Symbol,Quantity,Percent of Assets,Name,BBG FIGI,Country,Currency,Exchange,Exchange (fx) Rate,Market Currency,Sector',
  '2026-09-17,MRK,37710468.0000000000,4.9137166784,MERCK & CO INC,BBG000BPD257,US,USD,XNYS,1.0000000000,USD,Health Care',
  '2026-09-17,T,116803468.0000000000,4.1236578520,AT&T INC,BBG000BSJK37,US,USD,XNYS,1.0000000000,USD,Communication Services',
  '2026-09-17,USD,2832806.9200000000,0.0123721038,US DOLLAR,,US,USD,OTC,1.0000000000,USD,',
  '2026-09-17,,1.0000000000,0.0000000000,EMINI MAR 26,,US,USD,OTC,1.0000000000,USD,',
  '"Holdings may include collateral held by the fund for securities on loan. Holdings are subject to change."',
  '"The information contained herein is not intended as investment advice."',
].join('\r\n');

const BOND_HOLDINGS_CSV = [
  'As-Of-Date,Symbol,Quantity,Percent of Assets,Name,BBG FIGI,Country,Coupon Rate,Currency,Exchange,Exchange (fx) Rate,Market Currency,Maturity Date,Sector',
  '2026-09-17,TNOTE,334869900.0000000000,2.1731769354,TREASURY NOTE,BBG01CGJ5RZ0,US,3.5000000000,USD,BTEC,1.0000000000,USD,01/31/2028,',
  '2026-09-17,T,173777300.0000000000,1.1206402238,TREASURY NOTE,BBG01KR4STF6,US,3.7500000000,USD,BTEC,1.0000000000,USD,12/31/2028,',
  '2026-09-17,WIT,162645400.0000000000,1.0637483457,TREASURY NOTE,BBG01ZZ9ABC1,US,3.6250000000,USD,BTEC,1.0000000000,USD,09/15/2028,',
  '2026-09-17,USD,10000.0000000000,0.0800000000,US DOLLAR,,US,,USD,OTC,1.0000000000,USD,,',
  '"Holdings are subject to change."',
].join('\r\n');

const DISTRIBUTIONS_CSV = [
  'Ex-Date,Record Date,Payable Date,Income,Short-Term Capital Gain,Long-Term Capital Gain,Return Of Capital,Total Distribution',
  '06/24/2026,06/24/2026,06/30/2026,0.2525,0.0000,0.0000,--,0.252500000',
  '03/25/2026,03/25/2026,03/31/2026,0.2488,0.0000,0.0000,--,0.248800000',
  '12/10/2025,12/10/2025,12/15/2025,0.2701,0.0000,0.0000,--,0.270100000',
  '09/24/2025,09/24/2025,09/29/2025,0.2568,0.0000,0.0000,--,0.256800000',
  '06/25/2025,06/25/2025,06/30/2025,0.2702,0.0000,0.0000,--,0.270200000',
  '"Distributions are shown as declared and are not adjusted for splits."',
].join('\r\n');

// ---------------------------------------------------------------------------
// Helpers: temp feed directory, mocked Schwab/Yahoo "world", directory snapshot
// ---------------------------------------------------------------------------

const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
const urlOf = (input: any): string => String(input?.url ?? input);
const readIndex = (api: string): Record<string, any> => JSON.parse(readFileSync(join(api, 'index.json'), 'utf8'));
const readIndexRows = (api: string): Array<Record<string, any>> => readIndex(api).funds;
const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const configFile = () => JSON.parse(readFileSync(new URL('./update-data.config.json', import.meta.url), 'utf8'));

function sampleMeta(ticker: string): Record<string, any> {
  const me = { asOfDate: 'Aug 31 2026', ytd: 10, yr1: 12, yr3: 8, yr5: 7, yr10: 9, sinceInception: 8.5 };
  return {
    ticker, name: `Schwab ${ticker} ETF`, category: 'U.S. Equities', categoryPath: 'U.S. Equities',
    source: { fundPage: `https://www.schwabassetmanagement.com/products/${ticker.toLowerCase()}` },
    identifiers: { cusip: '808524797', isin: 'US8085247976', exchange: 'NYSE Arca, Inc.' },
    expenseRatio: { display: '0.06%', value: 0.06 }, nav: { display: '$30.00', value: 30, asOfDate: 'Sep 1 2026' },
    marketPrice: { display: '$30.01', value: 30.01 }, premiumDiscount: { display: '0.03%', value: 0.03 },
    aum: { display: '$1.00 B', value: 1e9 }, yields: { dividendYield: 2, secYield: 1.5 },
    returns: { derivedFrom: 'official Schwab product-page NAV total returns (month-end) where published; Yahoo adjusted market-price closes for missing values', performanceAsOf: '2026-08-31', monthEnd: me },
    distributions: { frequency: 'Quarterly', frequencyCode: '04 - Quarterly', rows: [['06/20/2026', '0.2'], ['09/23/2026', '0.25']] },
    holdings: { pages: [], totalRows: 5 }, history: { pages: ['history/001.json'], totalRows: 7 },
  };
}

function yahooPayload() {
  const start = Date.UTC(2024, 0, 2) / 1000;
  const timestamp = Array.from({ length: 1000 }, (_, i) => start + i * 86_400);
  const close = timestamp.map((_, i) => 20 + i * 0.01);
  return {
    chart: { result: [{
      meta: { exchangeName: 'PCX', regularMarketPrice: 30, regularMarketTime: timestamp[999], firstTradeDate: start },
      timestamp,
      indicators: { quote: [{ close, volume: timestamp.map(() => 1000) }], adjclose: [{ adjclose: close }] },
      events: { dividends: {} },
    }] },
  };
}

/** Serves the whole provider surface from the inline fixtures; `fail` makes matching URLs answer 404. */
function world(fail: RegExp | null = null, page: string = PRODUCT_PAGE_HTML): typeof fetch {
  return (async (input: any) => {
    const url = urlOf(input);
    const ok = (body: string) => new Response(body, { status: 200 });
    if (fail?.test(url)) return new Response('gone', { status: 404 });
    if (url.includes('/product-finder')) return ok(PRODUCT_FINDER_HTML);
    if (url.includes('/v8/finance/chart/')) return ok(JSON.stringify(yahooPayload()));
    if (url.includes('FundHoldings')) return ok(EQUITY_HOLDINGS_CSV);
    if (url.includes('Fund_Distributions')) return ok(DISTRIBUTIONS_CSV);
    // the fixture is the SCHD page: its rows are labelled with the ticker that was asked for
    if (url.includes('/products/')) return ok(page.replaceAll('SCHD', /\/products\/([a-z0-9.-]+)/i.exec(url)![1].toUpperCase()));
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Runs `run` against a temp api dir seeded with meta.json (+ history) for `meta` and an index.json listing `listed`. */
async function feed(
  opts: { meta?: string[]; listed?: string[]; env?: Record<string, string>; fetch?: typeof fetch },
  run: (api: string, calls: string[]) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'schwab-feed-'));
  const api = join(dir, 'api');
  const previousRoot = useApiRoot(pathToFileURL(api));
  const calls: string[] = [];
  const { log, warn } = console;
  try {
    for (const ticker of opts.meta ?? []) {
      mkdirSync(join(api, 'funds', ticker, 'history'), { recursive: true });
      writeFileSync(join(api, 'funds', ticker, 'meta.json'), JSON.stringify(sampleMeta(ticker)));
      writeFileSync(join(api, 'funds', ticker, 'history', '001.json'), JSON.stringify({ ticker, page: 1, rows: [{ Date: 'Oct 20 2011', Close: '10', 'Adj Close': '10', Volume: '1' }] }));
    }
    if (opts.listed) {
      mkdirSync(api, { recursive: true });
      writeFileSync(join(api, 'index.json'), JSON.stringify({ funds: opts.listed.map((ticker) => rowFromMeta(sampleMeta(ticker), 'Oct 20 2011')) }));
    }
    Object.assign(process.env, { REQUEST_SLEEP: '0', MAX_RETRIES: '1', CONCURRENCY: '1', EDGAR_FALLBACK: 'false', USE_SYSTEM_CA: 'false' }, opts.env);
    const impl = opts.fetch ?? offline;
    globalThis.fetch = (async (input: any, init?: any) => { calls.push(urlOf(input)); return impl(input, init); }) as typeof fetch;
    console.log = () => {};
    console.warn = () => {};
    await run(api, calls);
  } finally {
    console.log = log;
    console.warn = warn;
    useApiRoot(previousRoot);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every file under `dir` as path -> text, in sorted order, for exact before/after comparison. */
function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, snapshot(path, base));
    else out[path.slice(base.length)] = readFileSync(path, 'utf8');
  }
  return out;
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------

describe('controls', () => {
  test('precedence is file < advanced < nonblank inputs < env; blanks follow the documented rules', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'SCHD' }, { CONCURRENCY: 3, TICKERS: 'SCHB' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
    expect(c.CONCURRENCY).toBe('5');
    expect(c.TICKERS).toBe('SCHB');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
    expect(resolveControls({ AUM: '1B:' }, {}, {}, { UNRELATED: 'x', PATH: '/bin' }).AUM).toBe('1B:');
    // a blank input inherits the file value, advanced may blank a key, an explicitly set empty env var wins
    expect(resolveControls({ TICKERS: 'SCHD' }, {}, { TICKERS: '' }).TICKERS).toBe('SCHD');
    expect(resolveControls({ TICKERS: 'SCHD' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'SCHD' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
  });

  test('the scheduled path equals the config file, whose keys are exactly CONTROL_NAMES', () => {
    const defaults = configFile();
    expect(Object.keys(defaults).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(defaults)) expect(typeof value).toBe('string');
    expect(resolveControls(defaults, {}, {}, {})).toEqual(defaults);
  });

  test('strict validation rejects bad values, unknown keys, non-scalars and CR/LF/NUL in every layer', () => {
    const bad: unknown[] = [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { SEC_YIELD: '5:1' }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'a:b' }, { TICKERS: ['SCHD'] }, { TICKERS: { a: 1 } }, null, []];
    for (const value of bad) expect(() => resolveControls(value)).toThrow();
    expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, 'not an object')).toThrow();
  });

  test('HISTORY_RANGE is max or Ny', () => {
    for (const bad of ['bogus', '6mo', 'ytd', '0y', '5']) expect(() => resolveControls(configFile(), {}, {}, { HISTORY_RANGE: bad })).toThrow('HISTORY_RANGE');
    expect(resolveControls(configFile(), {}, {}, { HISTORY_RANGE: '5Y' }).HISTORY_RANGE).toBe('5Y');
  });

  test('USE_SYSTEM_CA is auto, true or false (case-insensitive, strict, default auto)', () => {
    expect(resolveControls(configFile()).USE_SYSTEM_CA).toBe('auto');
    for (const mode of ['auto', 'true', 'false', 'AUTO', 'True', 'FALSE']) expect(resolveControls(configFile(), {}, {}, { USE_SYSTEM_CA: mode }).USE_SYSTEM_CA).toBe(mode.toLowerCase());
    expect(() => resolveControls(configFile(), {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow('USE_SYSTEM_CA');
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(Object.assign(new Error('fetch failed'), { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }))).toBe(true);
    expect(isCertError(Object.assign(new Error('fetch failed'), { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
    expect(isCertError(null)).toBe(false);
  });

  test('installSystemCa wraps fetch only in auto mode and restarts once on a certificate error', async () => {
    const original = globalThis.fetch;
    let restarts = 0;
    const reexec = () => { restarts += 1; return undefined as never; };
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    expect(globalThis.fetch).toBe(original);
    installSystemCa('true', reexec, true);
    expect(restarts).toBe(0);
    installSystemCa('true', reexec, false);
    expect(restarts).toBe(1);

    restarts = 0;
    globalThis.fetch = (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } }); }) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await globalThis.fetch('https://example.invalid/');
    expect(restarts).toBe(1);
    globalThis.fetch = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await expect(globalThis.fetch('https://example.invalid/')).rejects.toThrow('ECONNRESET');
    expect(restarts).toBe(1);
  });

  test('config defaults reach readConfig; env overrides the file; TICKERS is validated', async () => {
    const c = readConfig(resolveControls(configFile()));
    expect([c.maxFetches, c.requestSleep, c.concurrency, c.holdingsPageSize, c.historyPageSize, c.maxRetries]).toEqual([0, 2, 2, 250, 1000, 2]);
    expect([c.historyRange, c.edgarFallback, c.skipSchwab, c.skipYahoo, c.storeRawDownloads]).toEqual(['max', true, false, false, false]);
    expect([c.tickers, c.aum, c.ter, c.dividendYield, c.secYield]).toEqual([null, undefined, undefined, undefined, undefined]);
    expect([c.performance, c.totalReturn]).toEqual([{}, {}]);
    expect(c.secUa).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig(resolveControls(configFile(), { SEC_UA: 'My Feed me@example.org' })).secUa).toBe('My Feed me@example.org');
    expect((await runtimeControls({})).REQUEST_SLEEP).toBe('2');
    expect((await runtimeControls({ REQUEST_SLEEP: '0', TICKERS: 'SCHD SCHB' })).TICKERS).toBe('SCHD SCHB');
    expect(() => readConfig({ TICKERS: 'SCHB $$$' })).toThrow('TICKERS');
    expect([...readConfig({ TICKERS: 'schb, schd' }).tickers!]).toEqual(['SCHB', 'SCHD']);
  });

  test('range parsers keep inclusive bounds and reject malformed ranges', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', TOTAL_RETURN_1Y: ':' }, 'PERFORMANCE')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

describe('parsing', () => {
  test('scalar helpers: missing values become null, never 0', () => {
    expect(numberOrNull('+0.25')).toBe(0.25);
    expect(numberOrNull('-0.01%')).toBe(-0.01);
    expect(numberOrNull('$112,770,927,091.11')).toBe(112_770_927_091.11);
    expect(numberOrNull('(1.5)')).toBe(-1.5);
    for (const blank of ['--', '—', '']) expect(numberOrNull(blank)).toBeNull();
    expect(firstNumber('3.25% As of 09/17/2026')).toBe(3.25);
    expect(firstNumber('09/18/2026 | $23.88')).toBe(23.88);
    expect(firstNumber('--')).toBeNull();
    expect(firstDate('Total Net Assets (as of 09/17/2026)')).toBe('2026-09-17');
    expect(firstDate('no date here')).toBeNull();
    expect(toIsoDate('2026-09-17')).toBe('2026-09-17');
    expect(toIsoDate('08/05/2010')).toBe('2010-08-05');
    expect(toIsoDate('10/10/19')).toBe('2019-10-10');
    expect(toIsoDate('')).toBe('');
    expect(isinFromCusip('808524797')).toBe('US8085247976');
    expect(isinFromCusip('808524805')).toBe('US8085248057');
    expect(isinFromCusip('bad')).toBe('');
  });

  test('month-name dates parse as UTC in any time zone', () => {
    for (const tz of ['Asia/Tokyo', 'Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      const script = "const m = await import(process.argv[1]); console.log(m.toIsoDate('Sep 30 2026') + '|' + m.toIsoDate('September 30, 2026'))";
      const run = spawnSync(process.execPath, ['-e', script, new URL('./update-data.ts', import.meta.url).pathname], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
      expect(run.stdout.trim()).toBe('2026-09-30|2026-09-30');
    }
  });

  test('text helpers: proxy preamble, html tables and anchors, label lookup', () => {
    expect(stripProxyPreamble('Title: x\n\nURL Source: y\n\nMarkdown Content:\nAs-Of-Date,Symbol\n1,2')).toBe('As-Of-Date,Symbol\n1,2');
    expect(stripProxyPreamble('plain')).toBe('plain');
    const text = htmlToText('<table><tr><th>CUSIP</th><td>808524797</td></tr></table><p><a href="/products/schd">SCHD<br>Schwab U.S. Dividend Equity ETF</a></p>');
    expect(text).toContain('| CUSIP | 808524797 |');
    expect(text).toContain('[SCHD Schwab U.S. Dividend Equity ETF](https://www.schwabassetmanagement.com/products/schd)');
    const lines = toTextLines(['| **Total Net Assets (as of 09/17/2026)** |  | $15,193,857,213.48 |', '*   ### **Fund Inception**', 'Fund Data 08/05/2010 ', 'Exchange NYSE Arca, Inc.'].join('\n'));
    expect(lookupLabel(lines, 'Total Net Assets')?.value).toBe('$15,193,857,213.48');
    expect(lookupLabel(lines, 'Total Net Assets')?.labelText).toContain('09/17/2026');
    expect(lookupLabel(lines, 'Fund Inception')?.value).toBe('08/05/2010');
    expect(lookupLabel(lines, 'Missing Label')).toBeNull();
  });

  test('catalog: proxied markdown rendering (list + table forms, net/gross TER, blank gross)', () => {
    const funds = parseCatalogText(PRODUCT_FINDER_MARKDOWN);
    expect(funds.map((fund) => fund.ticker)).toEqual(['SCHD', 'SCHJ', 'SCHK', 'SGVT', 'STCE']);
    const schj = funds.find((fund) => fund.ticker === 'SCHJ')!;
    expect([schj.name, schj.category, schj.ter, schj.grossTer, schj.inception, schj.asOfDate]).toEqual(['Schwab 1-5 Year Corporate Bond ETF', 'Fixed Income', 0.03, 0.03, '2019-10-10', '2026-08-27']);
    expect(schj.fundPage).toBe('https://www.schwabassetmanagement.com/products/schj');
    const schk = funds.find((fund) => fund.ticker === 'SCHK')!;
    expect([schk.category, schk.ter, schk.inception]).toEqual(['U.S. Equities', 0.03, '2017-10-11']);
    expect(funds.find((fund) => fund.ticker === 'STCE')!.name).toContain('Schwab Crypto Thematic');
    expect(funds.find((fund) => fund.ticker === 'SCHD')!.ter).toBe(0.06);
  });

  test('catalog: direct HTML rendering, blank gross TER is null, no rows is an error', () => {
    const funds = parseCatalogText(PRODUCT_FINDER_HTML);
    expect(funds.map((fund) => fund.ticker)).toEqual(['FNDE', 'SCHR', 'SCHX']);
    const schx = funds.find((fund) => fund.ticker === 'SCHX')!;
    expect([schx.name, schx.category, schx.ter, schx.grossTer, schx.inception]).toEqual(['Schwab U.S. Large-Cap ETF', 'U.S. Equities', 0.03, null, '2009-11-03']);
    expect(funds.find((fund) => fund.ticker === 'FNDE')!.grossTer).toBe(0.39);
    expect(() => parseCatalogText('<html><body>Access denied</body></html>')).toThrow(/no ETF rows/);
  });

  test('product page: proxied markdown rendering with month and quarter returns', () => {
    const s = parseProductPage(PRODUCT_PAGE_MARKDOWN, 'SCHO');
    expect([s.name, s.inception, s.totalNetAssets, s.totalNetAssetsAsOfDate, s.totalExpenseRatio]).toEqual(['Schwab Short-Term U.S. Treasury ETF', '2010-08-05', 15_193_857_213.48, '2026-09-17', 0.03]);
    expect([s.nav, s.navAsOfDate, s.sharesOutstanding, s.totalHoldings, s.portfolioTurnover]).toEqual([23.91, '2026-09-18', 635_570_000, 96, 63]);
    expect([s.cusip, s.exchange, s.indexName, s.morningstarCategory]).toEqual(['808524805', 'NYSE Arca, Inc.', 'Bloomberg US Treasury 1-3 Year Index', 'Short Government']);
    expect([s.secYield, s.secYieldAsOfDate, s.distributionYield, s.premiumDiscount, s.bidAskMidpoint]).toEqual([3.62, '2026-09-17', 3.91, -0.01, 23.91]);
    expect(s.holdingsCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_FundHoldings_2026-09-17.CSV');
    expect(s.distributionsCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_Fund_Distributions.CSV');
    expect(s.navHistoryCsvUrl).toContain('SCHO_NAV_History.CSV');
    expect(s.officialReturns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 0.25, mo3: 0.43, ytd: 1.04, yr1: 2.47, cagr3y: 4.23, cagr5y: 1.92, cagr10y: 1.77, siAnn: 1.37 });
    expect(s.officialReturns.monthEnd.marketPrice!.mo1).toBe(0.21);
    expect(s.officialReturns.quarterEnd.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 2.14, cagr3y: 4.0, cagr5y: 1.61, cagr10y: 1.71, siAnn: 1.34 });
  });

  test('product page: direct HTML rendering with relative CSV links', () => {
    const s = parseProductPage(PRODUCT_PAGE_HTML, 'SCHD');
    expect([s.name, s.cusip, s.nav, s.navAsOfDate, s.totalNetAssets, s.totalExpenseRatio, s.totalHoldings]).toEqual(['Schwab U.S. Dividend Equity ETF', '808524797', 33.66, '2026-09-18', 112_770_927_091.11, 0.06, 102]);
    expect([s.indexName, s.morningstarCategory, s.secYield, s.distributionYield, s.premiumDiscount, s.bidAskMidpoint]).toEqual(['Dow Jones U.S. Dividend 100™ Index', 'Large Value', 3.25, 3.0, 0.03, 33.88]);
    expect(s.holdingsCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_FundHoldings_2026-09-17.CSV');
    expect(s.distributionsCsvUrl).toContain('SCHD_Fund_Distributions.CSV');
    expect(s.officialReturns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 4.28, mo3: 8.24, ytd: 29.31, yr1: 29.56, cagr3y: 16.21, cagr5y: 10.02, cagr10y: 13.18, siAnn: 13.67 });
    expect(s.officialReturns.quarterEnd.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 24.03, cagr3y: 13.52, cagr5y: 8.51, cagr10y: 12.37, siAnn: 13.09 });
  });

  test('page-loaded check: quote, profile and both performance tables must be present; a missing yields table alone is not partial', () => {
    const cut = (html: string, from: string, to: string) => html.slice(0, html.indexOf(from)) + html.slice(html.indexOf(to));
    expect(parseProductPage(PRODUCT_PAGE_HTML, 'SCHD')).toMatchObject({ loadedFully: true, sections: { quote: true, profile: true, yields: true, recent: true, quarter: true } });
    expect(parseProductPage(PRODUCT_PAGE_MARKDOWN, 'SCHO')).toMatchObject({ loadedFully: true });
    const noPerformance = cut(PRODUCT_PAGE_HTML, '<h3>Monthly</h3>', '<p>As of 09/17/2026 <a');
    expect(parseProductPage(noPerformance, 'SCHD')).toMatchObject({ nav: 33.66, loadedFully: false, sections: { quote: true, profile: true, recent: false, quarter: false } });
    expect(parseProductPage(cut(PRODUCT_PAGE_HTML, '<h3>Quarterly</h3>', '<p>As of 09/17/2026 <a'), 'SCHD')).toMatchObject({ loadedFully: false, sections: { recent: true, quarter: false } });
    expect(parseProductPage(cut(PRODUCT_PAGE_HTML, '<ul><li><span>Bid/Ask', '<table><tr><th>Fund Inception'), 'SCHD')).toMatchObject({ loadedFully: false, premiumDiscount: null, sections: { quote: false, profile: true } });
    expect(parseProductPage(PRODUCT_PAGE_HTML.replace(/<tr><th>Total Net Assets.*?<\/tr>/, ''), 'SCHD')).toMatchObject({ loadedFully: false, sections: { profile: false } });
    expect(parseProductPage(cut(PRODUCT_PAGE_HTML, '<table><tr><th>SEC Yield', '<h3>Monthly</h3>'), 'SCHD')).toMatchObject({ loadedFully: true, sections: { yields: false } });
    expect(parseProductPage('<html><body>Access denied</body></html>', 'SCHD')).toMatchObject({ loadedFully: false, sections: { quote: false, profile: false, recent: false, quarter: false } });
    // a stray marker word is not a product page, a numeric NAV or Total Net Assets row is
    expect([isProductPage('<p>Total Expense Ratio</p>'), isProductPage(PRODUCT_PAGE_HTML), isProductPage(PRODUCT_PAGE_MARKDOWN), isProductPage(noPerformance)]).toEqual([false, true, true, true]);
  });

  test('product page: young-fund "--" cells and missing sections are null, not 0', () => {
    const lines = toTextLines(['### Monthly', ' 08/31/2026', '| **SGVT NAV** |  | +0.35 | +1.05 | +2.90 | +4.30 | -- | -- | -- | +4.35 |'].join('\n'));
    const returns = parseOfficialReturns(lines, 'SGVT');
    expect(returns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 0.35, mo3: 1.05, ytd: 2.9, yr1: 4.3, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: 4.35 });
    expect(returns.monthEnd.marketPrice).toBeNull();
    expect(returns.quarterEnd.nav).toBeNull();
    const empty = parseProductPage('<html><body>Access denied</body></html>', 'SCHD');
    expect([empty.nav, empty.totalNetAssets, empty.secYield, empty.officialReturns.monthEnd.nav]).toEqual([null, null, null, null]);
    expect(empty.cusip).toBe('');
    expect(parseFundName('# Schwab U.S. Dividend Equity ETF\n\n## Schwab Market Talk', 'SCHD')).toBe('Schwab U.S. Dividend Equity ETF');
    expect(parseFundName('Title: SCHD Schwab U.S. Dividend Equity ETF | Schwab Asset Management', 'SCHD')).toBe('Schwab U.S. Dividend Equity ETF');
    expect(parseFundName('## Schwab Market Talk\n\nAdvisors, join our monthly webcast', 'SCHD')).toBeNull();
  });

  test('holdings CSV: equity and bond layouts, cash rows kept, missing weight is "-" not "0"', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n\r\n1,2')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]);
    const equity = parseHoldingsCsv(EQUITY_HOLDINGS_CSV, 112_770_927_091.11);
    expect(equity.headers).toEqual(['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category']);
    expect([equity.asOfDate, equity.bond, equity.rows.length]).toEqual(['2026-09-17', false, 4]);
    expect(equity.rows[0]).toEqual({ Name: 'MERCK & CO INC', Ticker: 'MRK', Identifier: 'BBG000BPD257', Weight: '4.913717', 'Market Value': '5541243852.86', 'Shares Held': '37710468', 'Asset Category': 'Health Care' });
    expect(equity.rows[1].Ticker).toBe('T');
    expect(equity.rows[2]).toEqual({ Name: 'US DOLLAR', Ticker: 'USD', Identifier: '-', Weight: '0.012372', 'Market Value': '13952136.16', 'Shares Held': '2832806.92', 'Asset Category': '-' });
    expect(parseHoldingsCsv(EQUITY_HOLDINGS_CSV, null).rows[0]['Market Value']).toBe('-');
    expect(parseHoldingsCsv(`Title: \n\nURL Source: x\n\nMarkdown Content:\n${EQUITY_HOLDINGS_CSV}`, null).rows).toHaveLength(4);
    const bond = parseHoldingsCsv(BOND_HOLDINGS_CSV, 15_193_857_213.48);
    expect(bond.bond).toBe(true);
    expect(bond.headers).toEqual(['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category', 'Coupon', 'Maturity']);
    for (const row of bond.rows.slice(0, 3)) expect([row.Ticker, row['Asset Category']]).toEqual(['-', 'Fixed Income']);
    expect([bond.rows[0].Coupon, bond.rows[0].Maturity, bond.rows[1].Identifier]).toEqual(['3.5', '01/31/2028', 'BBG01KR4STF6']);
    expect(parseHoldingsCsv('As-Of-Date,Symbol,Name,Percent of Assets\n2026-09-30,AAA,Foo,\n2026-09-30,BBB,Bar,1.5\n').rows.map((row) => row.Weight)).toEqual(['-', '1.5']);
    expect(() => parseHoldingsCsv('<html>nope</html>')).toThrow(/header row not found/);
  });

  test('distributions CSV and URL helpers: ascending by ex-date, trailer dropped, candidates unique', () => {
    const rows = parseDistributionsCsv(DISTRIBUTIONS_CSV);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ epoch: Date.UTC(2025, 5, 25) / 1000, amount: 0.2702 });
    expect(rows[4]).toEqual({ epoch: Date.UTC(2026, 5, 24) / 1000, amount: 0.2525 });
    expect(rows.every((row, index) => index === 0 || row.epoch > rows[index - 1].epoch)).toBe(true);
    expect(() => parseDistributionsCsv('nothing')).toThrow(/header row not found/);
    expect(distributionsCsvUrl('schd')).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_Fund_Distributions.CSV');
    const candidates = holdingsCsvCandidates('SCHD', '2026-09-17', new Date('2026-09-19T12:00:00Z'));
    expect(candidates[0]).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_FundHoldings_2026-09-17.CSV');
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(proxyUrl('https://www.schwabassetmanagement.com/products/schd')).toBe('https://r.jina.ai/https://www.schwabassetmanagement.com/products/schd');
    expect(isHoldingsCsv(EQUITY_HOLDINGS_CSV)).toBe(true);
    expect(isHoldingsCsv('<html>blocked</html>')).toBe(false);
    expect(isDistributionsCsv(DISTRIBUTIONS_CSV)).toBe(true);
    expect(isDistributionsCsv(EQUITY_HOLDINGS_CSV)).toBe(false);
  });

  test('distribution frequency is inferred from the median gap and labelled like the client', () => {
    const at = (iso: string) => ({ epoch: Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 1000, amount: 0.1 });
    const monthly = ['2025-08-01', '2025-09-02', '2025-10-01', '2025-11-03', '2025-12-01', '2025-12-19', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'];
    expect(inferDistributionFrequency(monthly.map(at))).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(inferDistributionFrequency(['2025-03-26', '2025-06-25', '2025-09-24', '2025-12-10', '2026-03-25', '2026-06-24'].map(at))).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(inferDistributionFrequency(['2024-06-20', '2024-12-18', '2025-06-24', '2025-12-17', '2026-06-23'].map(at))).toEqual({ frequency: 'Semi-Annual', paymentsPerYear: 2 });
    expect(inferDistributionFrequency(['2023-12-20', '2024-12-18', '2025-12-17'].map(at))).toEqual({ frequency: 'Annual', paymentsPerYear: 1 });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }, { epoch: 900 * 86_400, amount: 1 }])).toEqual({ frequency: 'Irregular', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
    const labels = Object.fromEntries(['Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'Irregular', 'None', 'Unknown', '—', ''].map((value) => [value, frequencyCodeLabel(value)]));
    expect(labels).toEqual({ Monthly: '01 - Monthly', Quarterly: '04 - Quarterly', 'Semi-Annual': '06 - Semi-annually', Annual: '12 - Annually', Irregular: '99 - Irregular', None: '00 - None', Unknown: '00 - Unknown', '—': '00 - None', '': '00 - None' });
  });

  test('Yahoo chart: null closes dropped, dividends sorted, missing result is an error', () => {
    const chart = parseChart({
      chart: { result: [{
        meta: { exchangeName: 'PCX', regularMarketPrice: 33.7, regularMarketTime: 1_789_000_000, firstTradeDate: 1_319_000_000 },
        timestamp: [1_600_000_000, 1_600_086_400, 1_600_172_800],
        indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
        events: { dividends: { '1600086400': { amount: 0.25, date: 1_600_086_400 } } },
      }] },
    });
    expect(chart.days).toHaveLength(2);
    expect(chart.days[0]).toEqual({ date: '2020-09-13', close: 10, adjClose: 9, volume: 100 });
    expect(chart.dividends).toEqual([{ epoch: 1_600_086_400, amount: 0.25 }]);
    expect(chart.exchangeName).toBe('PCX');
    expect(() => parseChart({})).toThrow(/no result/);
  });

  test('SEC EDGAR fallback: ticker map, original NPORT-P filings only, N-PORT holdings and net assets', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1454889, 'S000034073', 'C000104937', 'SCHD'], [1454889, 'S000027575', 'C000083337', 'SCHX']] });
    expect(map.get('SCHD')).toEqual({ cik: '0001454889', seriesId: 'S000034073', classId: 'C000104937' });
    expect(map.size).toBe(2);
    const atom = '<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1454889/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry><entry><content><accession-number>0001752724-26-000002</accession-number><filing-type>NPORT-P/A</filing-type></content></entry></feed>';
    const filings = parseEdgarAtomFilings(atom);
    expect(filings).toHaveLength(1);
    expect(filings[0].url).toBe(nportUrlFor('0001454889', '0001752724-26-000001'));
    const xml = `<edgarSubmission><genInfo><seriesName>Schwab U.S. Dividend Equity ETF</seriesName><seriesId>S000034073</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>112770927091.11</netAssets></fundInfo>
<invstOrSecs><invstOrSec><name>MERCK &amp; CO INC</name><cusip>58933Y105</cusip><balance>37710468</balance><valUSD>5541249108.24</valUSD><pctVal>4.91</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>UNITED STATES TREASURY NOTE</name><cusip>91282CJL6</cusip><balance>1000000</balance><valUSD>990000</valUSD><pctVal>0.5</pctVal><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.5</annualizedRt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`;
    const parsed = parseNport(xml);
    expect([parsed.seriesId, parsed.repPdDate, parsed.netAssets, parsed.holdings.length]).toEqual(['S000034073', '2026-06-30', 112_770_927_091.11, 2]);
    expect(parsed.holdings[0]).toEqual({ Name: 'MERCK & CO INC', Ticker: '-', Identifier: '58933Y105', Weight: '4.91', 'Market Value': '5541249108.24', 'Shares Held': '37710468', 'Asset Category': 'EC' });
    expect([parsed.holdings[1].Coupon, parsed.holdings[1].Maturity]).toEqual(['3.5', '2028-01-31']);
    expect(normalizeHoldingName('Merck & Co., Inc.')).toBe('MERCK AND');
    expect(cleanHoldingTicker(' n/a ')).toBe('');
    expect(cleanHoldingTicker('brk.b')).toBe('BRK.B');
  });
});

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------

describe('metrics', () => {
  const day = (date: string, close: number) => ({ date, close, adjClose: close, volume: 1 });

  test('price returns: YTD, QTD, 1Y; horizons the fund is too young for are null', () => {
    const r = priceReturns([day('2025-09-10', 100), day('2025-12-31', 110), day('2026-06-30', 115), day('2026-09-17', 121)]);
    expect([r.asOfDate, r.ytd, r.qtd, r.yr1, r.cagr3y]).toEqual(['2026-09-17', 10, 5.22, 21, null]);
    expect(priceReturns([day('2026-09-30', 10), day('2026-10-01', 10.5)]).qtd).toBe(5);
    expect(priceReturns([day('2026-10-01', 10.5)]).qtd).toBeNull();
    expect(priceReturns([day('2026-09-01', 10), day('2026-10-01', 10.2)]).siAnn).toBeNull();
    expect(priceReturns([day('2024-09-30', 10), day('2026-10-01', 12)]).siAnn).not.toBeNull();
    expect(annualizedToTotal(10, 3)).toBe(33.1);
    expect(annualizedToTotal(null, 3)).toBeNull();
  });

  test('official returns win over derived ones but keep the derived QTD', () => {
    const derived = { asOfDate: '2026-09-18', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const official = { asOfDate: '2026-08-31', mo1: 0.25, mo3: 0.43, ytd: 1.04, yr1: 2.47, cagr3y: 4.23, cagr5y: null, cagr10y: 1.77, siAnn: 1.37 };
    expect(mergeOfficialReturns(derived, official)).toEqual({ asOfDate: '2026-08-31', mo1: 0.25, qtd: 2, ytd: 1.04, yr1: 2.47, cagr3y: 4.23, cagr5y: 6, cagr10y: 1.77, siAnn: 1.37 });
    expect(mergeOfficialReturns(derived, null)).toBe(derived);
  });

  test('returnsBasis and performanceAsOf travel together (official table date vs last Yahoo close)', () => {
    const fund = { dividendYield: 3, secYield: 3.39 } as never;
    const derived = { asOfDate: '2026-09-18', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const official = mergeOfficialReturns(derived, { asOfDate: '2026-08-31', mo1: 0.25, mo3: 0.43, ytd: 1.04, yr1: 2.47, cagr3y: 4.23, cagr5y: null, cagr10y: 1.77, siAnn: 1.37 });
    const a = deriveMetrics(official, fund, [], { paymentsPerYear: 4 }, 30, true);
    expect(a.performanceAsOf).toBe('2026-08-31');
    expect(String(a.returnsBasis)).toContain('official Schwab');
    expect(Object.keys(a).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    const b = deriveMetrics(derived, fund, [], { paymentsPerYear: 4 }, 30, false);
    expect(b.performanceAsOf).toBe('2026-09-18');
    expect(String(b.returnsBasis)).toContain('Yahoo');
    expect(deriveMetrics(priceReturns([]), fund, [], { paymentsPerYear: 4 }, 30, false).performanceAsOf).toBeNull();
    expect(performanceAsOf('')).toBeNull();
    expect(performanceAsOf('n/a')).toBeNull();
  });

  test('a young fund with no data gets null metrics (never 0) and the same key set as a full row', () => {
    const young = deriveMetrics(priceReturns([]), { dividendYield: null, secYield: null } as never, [], { paymentsPerYear: null }, null, false);
    for (const key of ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'secYield']) expect(young[key]).toBeNull();
    expect([young.dividendYieldText, young.secYieldText]).toEqual(['—', '—']);
    const full = rowFromMeta(sampleMeta('SCHX'), 'Oct 20 2011');
    const sparse = rowFromMeta({ ticker: 'NEW', returns: {} });
    expect(Object.keys(full.metrics)).toEqual(Object.keys(young));
    expect(Object.keys(sparse.metrics)).toEqual(Object.keys(young));
    for (const key of ['ytd', 'tr1y', 'tr3y', 'cagr3y', 'siAnn', 'dividendYield', 'performanceAsOf']) expect(sparse.metrics[key]).toBeNull();
    expect(sparse.metrics.returnsBasis.length).toBeGreaterThan(0);
  });

  test('dividendYieldBasis names the definition behind dividendYield and is null exactly when the yield is null', () => {
    const none = priceReturns([]);
    const derive = (fund: object, dividends: { amount: number }[] = []) => deriveMetrics(none, { dividendYield: null, secYield: null, ...fund } as never, dividends as never, { paymentsPerYear: 4 }, 25, false);
    // published "Distribution Yield (TTM)" on the product page
    expect(derive({ dividendYield: 3, dividendYieldBasis: 'official-trailing-12m' })).toMatchObject({ dividendYield: 3, dividendYieldBasis: 'official-trailing-12m' });
    // updater estimate: latest distribution x payments per year / price
    expect(derive({}, [{ amount: 0.25 }])).toMatchObject({ dividendYield: 4, dividendYieldBasis: 'indicated' });
    // a yield carried over from the previous index keeps its recorded code, an unrecorded one is official-other
    expect(derive({ dividendYield: 2, dividendYieldBasis: 'indicated' }).dividendYieldBasis).toBe('indicated');
    expect(derive({ dividendYield: 2 }).dividendYieldBasis).toBe('official-other');
    // no yield, no code
    expect(derive({})).toMatchObject({ dividendYield: null, dividendYieldBasis: null });
    // rows rebuilt from meta: stored code, legacy kind text, unknown text, null yield
    const rebuilt = (yields: object) => rowFromMeta({ ...sampleMeta('SCHX'), yields }, 'Oct 20 2011').metrics;
    expect(rebuilt({ dividendYield: 2, dividendYieldBasis: 'computed-trailing-12m' }).dividendYieldBasis).toBe('computed-trailing-12m');
    expect(rebuilt({ dividendYield: 2, dividendYieldKind: 'Distribution Yield (TTM) published on the official product page as of Aug 31 2026' }).dividendYieldBasis).toBe('official-trailing-12m');
    expect(rebuilt({ dividendYield: 2, dividendYieldKind: 'indicated (latest distribution x inferred payments per year / NAV)' }).dividendYieldBasis).toBe('indicated');
    expect(rebuilt({ dividendYield: 2, dividendYieldBasis: 'free text', dividendYieldKind: 'something else' }).dividendYieldBasis).toBe('official-other');
    expect(rebuilt({ dividendYield: null, dividendYieldBasis: 'indicated' }).dividendYieldBasis).toBeNull();
    // fresh, rebuilt and placeholder rows share one key set
    const placeholder = placeholderRow({ ticker: 'X', name: 'X', category: 'ETF', fundPage: '', cusip: '', isin: '', exchange: '', ter: null, inception: null }).metrics;
    expect(placeholder.dividendYieldBasis).toBeNull();
    expect(Object.keys(placeholder)).toEqual(Object.keys(derive({})));
    expect(Object.keys(rebuilt({ dividendYield: 2 }))).toEqual(Object.keys(placeholder));
  });

  test('rowFromMeta builds the standard row; bounded return filters exclude funds with no value', () => {
    const row = rowFromMeta(sampleMeta('SCHX'), 'Oct 20 2011');
    expect(row.dataFile).toBe('./funds/SCHX/meta.json');
    expect(row.metrics.returnsBasis).toContain('official Schwab');
    expect(row.metrics.performanceAsOf).toBe('2026-08-31');
    expect(row.metrics.tr3y).toBe(annualizedToTotal(8, 3));
    expect(row.distributions).toEqual({ frequency: 'Quarterly', exDate: '09/23/2026', dividend: '0.25' });
    expect([row.holdings, row.history]).toEqual([5, 7]);
    expect(rowFromMeta({ ...sampleMeta('SCHX'), returns: { monthEnd: { asOfDate: 'Aug 31 2026' } } }).metrics.performanceAsOf).toBe('2026-08-31');
    const config = readConfig({ PERFORMANCE_3Y: '5:', TOTAL_RETURN_5Y: ':50' });
    const fund = { ticker: 'X', netAssets: 1 } as any;
    expect(postFetchFilterReasons(fund, { cagr3y: null, tr5y: null }, config)).toEqual(['PERFORMANCE_3Y', 'TOTAL_RETURN_5Y']);
    expect(postFetchFilterReasons(fund, { cagr3y: 6, tr5y: 40 }, config)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pipeline (mocked fetch, temp api dir)
// ---------------------------------------------------------------------------

describe('pipeline', () => {
  test('a one-ticker run keeps every row, including funds the index lost', async () => {
    // index.json lists only SCHD (the incident); three funds have meta.json
    await feed({ meta: ['SCHD', 'SCHX', 'SCHB'], listed: ['SCHD'], env: { TICKERS: 'SCHX', SKIP_SCHWAB: 'true', SKIP_YAHOO: 'true' } }, async (api, calls) => {
      expect([...(await readMissingRows(new Set(['SCHD']))).keys()].sort()).toEqual(['SCHB', 'SCHX']);
      await main();
      const rows = readIndexRows(api);
      expect(rows.map((row) => row.ticker)).toEqual(['SCHB', 'SCHD', 'SCHX']);
      expect(readIndex(api).counts.funds).toBe(3);
      for (const row of rows) expect([row.dataFile, typeof row.metrics.returnsBasis]).toEqual([`./funds/${row.ticker}/meta.json`, 'string']);
      expect(calls).toEqual([]);
    });
  });

  test('a full run publishes one metrics key set; identical re-runs (full and one-ticker) write nothing', async () => {
    await feed({ fetch: world() }, async (api) => {
      await main();
      const rows = readIndexRows(api);
      expect(rows.map((row) => row.ticker)).toEqual(['FNDE', 'SCHR', 'SCHX']);
      for (const row of rows) {
        expect(Object.keys(row.metrics)).toEqual(Object.keys(rows[0].metrics));
        expect(row.dataFile).toBe(`./funds/${row.ticker}/meta.json`);
        expect(statSync(join(api, 'funds', row.ticker, 'meta.json')).isFile()).toBe(true);
        expect(row.metrics.dividendYieldBasis === null).toBe(row.metrics.dividendYield === null);
        expect(row.metrics.returnsBasis.length).toBeGreaterThan(0);
        expect(row.metrics.performanceAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      const first = snapshot(api);
      await main();
      expect(snapshot(api)).toEqual(first);
      process.env.TICKERS = 'SCHR';
      await main();
      expect(readIndexRows(api)).toHaveLength(3);
      expect(snapshot(api)).toEqual(first);
    });
  });

  test('a failed source keeps the fund exactly as published', async () => {
    await feed({ fetch: world() }, async (api) => {
      await main();
      const first = snapshot(api);
      globalThis.fetch = world(/finance\/chart/);
      process.env.TICKERS = 'SCHX';
      await main();
      expect(snapshot(api)).toEqual(first);
      expect(readIndexRows(api)).toHaveLength(3);
    });
    await feed({ meta: ['SCHX'], listed: ['SCHX'], env: { TICKERS: 'SCHX', SKIP_SCHWAB: 'true' } }, async (api) => {
      const before = snapshot(join(api, 'funds'));
      await main();
      expect(snapshot(join(api, 'funds'))).toEqual(before);
      expect(readIndexRows(api)).toHaveLength(1);
    });
  });

  test('a live catalog without a known fund, filters and MAX_FETCHES drop nothing', async () => {
    // the mocked product finder lists FNDE, SCHR and SCHX; SCHD is absent from it, SCHB exists only as meta.json
    const catalogOnly = (async (input: any) => {
      if (urlOf(input).includes('/product-finder')) return new Response(PRODUCT_FINDER_HTML, { status: 200 });
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await feed({ meta: ['SCHD', 'SCHX', 'SCHB'], listed: ['SCHD', 'SCHX'], env: { TER: '0.9:', MAX_FETCHES: '1' }, fetch: catalogOnly }, async (api, calls) => {
      await main();
      expect(calls.some((url) => url.includes('/product-finder'))).toBe(true);
      // listed funds without any published data (FNDE, SCHR) still get a catalog-only row
      expect(readIndexRows(api).map((row) => [row.ticker, row.dataFile === null])).toEqual([['FNDE', true], ['SCHB', false], ['SCHD', false], ['SCHR', true], ['SCHX', false]]);
    });
  });

  test('a partial product page keeps the published official sections (zero diff); a fully loaded page lacking a field is an honest null', async () => {
    const cut = (html: string, from: string, to: string) => html.slice(0, html.indexOf(from)) + html.slice(html.indexOf(to));
    const partials = {
      'performance tables': cut(PRODUCT_PAGE_HTML, '<h3>Monthly</h3>', '<p>As of 09/17/2026 <a'),
      'quote details and yields': cut(cut(PRODUCT_PAGE_HTML, '<ul><li><span>Bid/Ask', '<table><tr><th>Fund Inception'), '<table><tr><th>SEC Yield', '<h3>Monthly</h3>'),
      'profile row and quarterly table': cut(PRODUCT_PAGE_HTML.replace(/<tr><th>Total Net Assets.*?<\/tr>/, ''), '<h3>Quarterly</h3>', '<p>As of 09/17/2026 <a'),
    };
    await feed({ fetch: world() }, async (api) => {
      await main();
      const published = snapshot(api);
      const meta = JSON.parse(readFileSync(join(api, 'funds/SCHX/meta.json'), 'utf8'));
      expect(meta).toMatchObject({ premiumDiscount: { value: 0.03, source: 'official product page Quote Details' }, yields: { secYield: 3.25, distributionRate: 3 }, returns: { derivedFrom: expect.stringContaining('official') } });
      for (const [name, page] of Object.entries(partials)) {
        const lines: string[] = [];
        console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
        globalThis.fetch = world(null, page);
        await main();
        expect([name, snapshot(api)]).toEqual([name, published]); // meta.json, history, holdings, index.json: zero diff
        expect([name, lines.filter((line) => line.startsWith('[ kept')).length]).toEqual([name, 3]); // one notice per fund
      }
      // the product finder failing in the same run keeps the published gross expense ratio (the finder is its only source)
      expect(JSON.parse(published['/funds/FNDE/meta.json']).expenseRatio.gross).toBe(0.39);
      globalThis.fetch = world(/product-finder/, partials['performance tables']);
      await main();
      expect(snapshot(api)).toEqual(published);
      const lines: string[] = [];
      console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
      globalThis.fetch = world(null, partials['performance tables']);
      await main();
      expect(lines.find((line) => line.includes('SCHX') && line.startsWith('[ kept'))).toContain('kept the published month-end returns, quarter-end returns');
      expect(readIndexRows(api).find((row) => row.ticker === 'SCHX')!.metrics).toMatchObject({ tr1y: 29.56, secYield: 3.25, performanceAsOf: '2026-08-31' });

      // a page that loaded fully but really has no SEC yield (and a new NAV) is fresh data with an honest null, nothing is kept
      lines.length = 0;
      globalThis.fetch = world(null, PRODUCT_PAGE_HTML.replace(/<tr><th>SEC Yield.*?<\/tr>/, '').replace('$33.66', '$33.70'));
      await main();
      expect(lines.filter((line) => line.startsWith('[ kept'))).toEqual([]);
      const fresh = JSON.parse(readFileSync(join(api, 'funds/SCHX/meta.json'), 'utf8'));
      expect(fresh.nav.value).toBe(33.7);
      expect(fresh.yields).toMatchObject({ secYield: null, secYieldText: '—', distributionRate: 3 });
      expect(fresh.yields.secYieldKind).toContain('not published');
    });
  }, 30_000);

  test('a new fund whose required source failed gets a catalog-only row (dataFile null, full metrics key set) and no files', async () => {
    await feed({ meta: ['SCHX'], listed: ['SCHX'], env: { TICKERS: 'FNDE' }, fetch: world(/products\/fnde/i) }, async (api) => {
      await main();
      const rows = readIndexRows(api);
      expect(rows.map((row) => row.ticker)).toEqual(['FNDE', 'SCHR', 'SCHX']);
      const row = rows.find((item) => item.ticker === 'FNDE')!;
      expect(row).toMatchObject({ dataFile: null, name: 'Schwab Fundamental Emerging Markets Equity ETF', holdings: 0, history: 0 });
      expect(Object.keys(row.metrics).sort()).toEqual(Object.keys(rows.find((item) => item.ticker === 'SCHX')!.metrics).sort());
      expect(row.metrics).toMatchObject({ ytd: null, tr1y: null, secYield: null, performanceAsOf: null });
      expect(String(row.metrics.returnsBasis).length).toBeGreaterThan(0);
      expect(() => statSync(join(api, 'funds/FNDE'))).toThrow();
      expect(placeholderRow({ ticker: 'X', name: 'X', category: 'ETF', fundPage: '', cusip: '', isin: '', exchange: '', ter: null, inception: null }).dataFile).toBeNull();
    });
  });

  test('MAX_FETCHES resumes from a cursor that ignores catalog-filtered funds', async () => {
    await feed({ meta: ['SCHB', 'SCHD', 'SCHX'], listed: ['SCHB', 'SCHD', 'SCHX'], env: { TER: ':1', MAX_FETCHES: '1', SKIP_SCHWAB: 'true', SKIP_YAHOO: 'true' } }, async (api) => {
      const rows = readIndexRows(api);
      writeFileSync(join(api, 'index.json'), JSON.stringify({ funds: rows.map((row) => (row.ticker === 'SCHB' ? { ...row, terValue: 5 } : row)) }));
      const cursor = () => JSON.parse(readFileSync(join(api, 'update-state.json'), 'utf8')).cursor;
      const seen: string[] = [];
      for (let i = 0; i < 3; i += 1) { await main(); seen.push(cursor()); }
      expect(seen).toEqual(['SCHD', 'SCHX', 'SCHD']);
      expect(readIndexRows(api)).toHaveLength(3);
    });
  });

  test('a TICKERS run leaves the cursor untouched and an unknown ticker is an error', async () => {
    await feed({ meta: ['SCHB', 'SCHD'], listed: ['SCHB', 'SCHD'], env: { TICKERS: 'SCHB', MAX_FETCHES: '1', SKIP_SCHWAB: 'true', SKIP_YAHOO: 'true' } }, async (api) => {
      const state = JSON.stringify({ cursor: 'SCHB', scope: 'other', savedAt: 'x' });
      writeFileSync(join(api, 'update-state.json'), state);
      await main();
      expect(readFileSync(join(api, 'update-state.json'), 'utf8')).toBe(state);
      process.env.TICKERS = 'NOPE';
      await expect(main()).rejects.toThrow('NOPE');
    });
  });
});

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

describe('network', () => {
  test('the request timeout covers the body, not only the headers', async () => {
    const realTimeout = AbortSignal.timeout;
    const requested: number[] = [];
    AbortSignal.timeout = ((ms: number) => { requested.push(ms); return realTimeout.call(AbortSignal, 30); }) as typeof AbortSignal.timeout;
    try {
      globalThis.fetch = (async (_url: any, init?: any) => ({
        ok: true,
        status: 200,
        // headers arrive at once; the body only ends when the abort signal fires (or, if it never does, after 1.5 s)
        text: () => new Promise<string>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted while reading the body')));
          setTimeout(() => resolve('late body'), 1500);
        }),
      })) as unknown as typeof fetch;
      configurePacing(0, 1);
      await expect(fetchText('https://example.test/slow', 'slow', { ...readConfig({}), maxRetries: 0 })).rejects.toThrow('aborted while reading the body');
      expect(requested).toEqual([FETCH_TIMEOUT_MS]);
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });

  test('every request carries a timeout signal and the rate-limited proxy is retried at most once', async () => {
    const seen: Array<{ url: string; signal: unknown }> = [];
    globalThis.fetch = (async (input: any, init?: any) => { seen.push({ url: urlOf(input), signal: init?.signal }); return new Response('boom', { status: 500 }); }) as typeof fetch;
    configurePacing(0, 1);
    await expect(fetchText(proxyUrl('https://example.test/a'), 'proxy', readConfig({ MAX_RETRIES: '5' }))).rejects.toThrow('500');
    expect(seen).toHaveLength(2);
    expect(seen.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    seen.length = 0;
    await expect(fetchText('https://example.test/b', 'direct', { ...readConfig({}), maxRetries: 0 })).rejects.toThrow('500');
    expect(seen).toHaveLength(1);
  }, 20_000);

  test('request lanes: peak in-flight is 1 at CONCURRENCY=1 and N at CONCURRENCY=N', async () => {
    for (const [concurrency, expected] of [[1, 1], [4, 4]] as const) {
      configurePacing(0.02, concurrency);
      let inFlight = 0;
      let peak = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        for (let i = 0; i < 3; i += 1) {
          await paceRequests(false);
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await sleepMs(5);
          inFlight -= 1;
        }
      }));
      expect(peak).toBe(expected);
    }
  });

  test('main fetches funds in parallel: peak in-flight product pages is 1 at CONCURRENCY=1 and 3 at 3', async () => {
    for (const [concurrency, expected] of [[1, 1], [3, 3]] as const) {
      const inner = world();
      let current = 0;
      let peak = 0;
      const tracked = (async (input: any, init?: any) => {
        current += 1;
        peak = Math.max(peak, current);
        try {
          // hold product-page requests until all workers have one in flight (bounded wait, no timing assertion)
          if (urlOf(input).includes('/products/') && concurrency > 1) for (let i = 0; i < 400 && current < concurrency; i += 1) await sleepMs(5);
          return await inner(input, init);
        } finally {
          current -= 1;
        }
      }) as typeof fetch;
      await feed({ fetch: tracked, env: { CONCURRENCY: String(concurrency) } }, async () => { await main(); });
      expect(peak).toBe(expected);
    }
  });

  test('HISTORY_RANGE shrinks the Yahoo request through explicit period1 (no range parameter)', async () => {
    const now = Date.UTC(2026, 9, 1, 12);
    expect(historyPeriodStart('max', now)).toBe(0);
    expect(historyPeriodStart('5y', now)).toBe(Math.floor(now / 1000 - 5 * 365.25 * 86_400));
    const chartUrl = (calls: string[]) => new URL(calls.find((call) => call.includes('/v8/finance/chart/SCHX'))!);
    await feed({ meta: ['SCHX'], listed: ['SCHX'], env: { SKIP_SCHWAB: 'true', HISTORY_RANGE: '5y', TICKERS: 'SCHX' } }, async (_api, calls) => {
      await main();
      const url = chartUrl(calls);
      expect(Number(url.searchParams.get('period1'))).toBeGreaterThan(Date.now() / 1000 - 5.1 * 365.25 * 86_400);
      expect(url.searchParams.has('period2')).toBe(true);
      expect(url.searchParams.has('range')).toBe(false);
    });
    await feed({ meta: ['SCHX'], listed: ['SCHX'], env: { SKIP_SCHWAB: 'true', HISTORY_RANGE: 'max', TICKERS: 'SCHX' } }, async (_api, calls) => {
      await main();
      expect(chartUrl(calls).searchParams.get('period1')).toBe('0');
    });
  });

  test('the soft deadline stops new funds before the workflow timeout', () => {
    expect(softDeadlineReached(0, 24 * 60_000)).toBe(false);
    expect(softDeadlineReached(0, 25 * 60_000)).toBe(true);
  });
});
