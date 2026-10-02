// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  CONTROL_NAMES,
  installSystemCa,
  isCertError,
  readConfig,
  resolveControls,
  runtimeControls,
  annualizedToTotal,
  cleanHoldingTicker,
  distributionsCsvUrl,
  firstDate,
  firstNumber,
  deriveMetrics,
  frequencyCodeLabel,
  holdingsCsvCandidates,
  htmlToText,
  inferDistributionFrequency,
  isDistributionsCsv,
  isHoldingsCsv,
  isinFromCusip,
  lookupLabel,
  mergeOfficialReturns,
  normalizeHoldingName,
  nportUrlFor,
  numberOrNull,
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
  performanceAsOf,
  parseProductPage,
  parseRange,
  priceReturns,
  proxyUrl,
  stripProxyPreamble,
  toIsoDate,
  toTextLines,
  parseRanges,
} from './update-data';

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

describe('range parsers', () => {
  test('parseRange keeps inclusive numeric bounds', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
  });

  test('parseAumRange supports dollar suffixes and sibling presets', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

describe('scalar helpers', () => {
  test('numberOrNull handles signs, placeholders, currency and parentheses', () => {
    expect(numberOrNull('+0.25')).toBe(0.25);
    expect(numberOrNull('-0.01%')).toBe(-0.01);
    expect(numberOrNull('$112,770,927,091.11')).toBe(112_770_927_091.11);
    expect(numberOrNull('(1.5)')).toBe(-1.5);
    expect(numberOrNull('--')).toBeNull();
    expect(numberOrNull('—')).toBeNull();
    expect(numberOrNull('')).toBeNull();
  });

  test('toIsoDate accepts ISO, US and two-digit-year US dates', () => {
    expect(toIsoDate('2026-09-17')).toBe('2026-09-17');
    expect(toIsoDate('08/05/2010')).toBe('2010-08-05');
    expect(toIsoDate('10/10/19')).toBe('2019-10-10');
    expect(toIsoDate('11/03/09')).toBe('2009-11-03');
    expect(toIsoDate('')).toBe('');
  });

  test('firstNumber / firstDate pull the value out of free text', () => {
    expect(firstNumber('3.25% As of 09/17/2026')).toBe(3.25);
    expect(firstNumber('$15,193,857,213.48 ')).toBe(15_193_857_213.48);
    expect(firstNumber('--')).toBeNull();
    expect(firstNumber('09/18/2026 | $23.88')).toBe(23.88);
    expect(firstNumber('09/17/2026 | 97')).toBe(97);
    expect(firstNumber('08/31/2026 | 61.57%')).toBe(61.57);
    expect(firstDate('Total Net Assets (as of 09/17/2026)')).toBe('2026-09-17');
    expect(firstDate('no date here')).toBeNull();
  });

  test('isinFromCusip derives the ISIN with the Luhn check digit', () => {
    expect(isinFromCusip('808524797')).toBe('US8085247976'); // SCHD
    expect(isinFromCusip('808524805')).toBe('US8085248057'); // SCHO
    expect(isinFromCusip('bad')).toBe('');
  });

  test('annualizedToTotal compounds the CAGR', () => {
    expect(annualizedToTotal(10, 3)).toBe(33.1);
    expect(annualizedToTotal(null, 3)).toBeNull();
  });

  test('csv/url helpers', () => {
    expect(distributionsCsvUrl('schd')).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_Fund_Distributions.CSV');
    const candidates = holdingsCsvCandidates('SCHD', '2026-09-17', new Date('2026-09-19T12:00:00Z'));
    expect(candidates[0]).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_FundHoldings_2026-09-17.CSV');
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.every((url) => /SCHD_FundHoldings_\d{4}-\d{2}-\d{2}\.CSV$/.test(url))).toBe(true);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(proxyUrl('https://www.schwabassetmanagement.com/products/schd')).toBe('https://r.jina.ai/https://www.schwabassetmanagement.com/products/schd');
    expect(isHoldingsCsv(EQUITY_HOLDINGS_CSV)).toBe(true);
    expect(isHoldingsCsv('<html>blocked</html>')).toBe(false);
    expect(isDistributionsCsv(DISTRIBUTIONS_CSV)).toBe(true);
    expect(isDistributionsCsv(EQUITY_HOLDINGS_CSV)).toBe(false);
  });
});

describe('text normalization', () => {
  test('stripProxyPreamble removes the r.jina.ai header', () => {
    expect(stripProxyPreamble('Title: x\n\nURL Source: y\n\nMarkdown Content:\nAs-Of-Date,Symbol\n1,2')).toBe('As-Of-Date,Symbol\n1,2');
    expect(stripProxyPreamble('plain')).toBe('plain');
  });

  test('htmlToText renders tables as pipe rows and anchors as markdown links', () => {
    const text = htmlToText('<table><tr><th>CUSIP</th><td>808524797</td></tr></table><p><a href="/products/schd">SCHD<br>Schwab U.S. Dividend Equity ETF</a></p>');
    expect(text).toContain('| CUSIP | 808524797 |');
    expect(text).toContain('[SCHD Schwab U.S. Dividend Equity ETF](https://www.schwabassetmanagement.com/products/schd)');
    expect(htmlToText('plain, no tags')).toBe('plain, no tags');
  });

  test('lookupLabel reads table rows, heading + Fund Data pairs and label-value lines', () => {
    const lines = toTextLines(['| **Total Net Assets (as of 09/17/2026)** |  | $15,193,857,213.48 |', '*   ### **Fund Inception**', 'Fund Data 08/05/2010 ', 'Exchange NYSE Arca, Inc.'].join('\n'));
    expect(lookupLabel(lines, 'Total Net Assets')?.value).toBe('$15,193,857,213.48');
    expect(lookupLabel(lines, 'Total Net Assets')?.labelText).toContain('09/17/2026');
    expect(lookupLabel(lines, 'Fund Inception')?.value).toBe('08/05/2010');
    expect(lookupLabel(lines, 'Missing Label')).toBeNull();
  });
});

describe('Schwab product finder parser', () => {
  test('reads the proxied markdown rendering (list + table forms, blank gross ER)', () => {
    const funds = parseCatalogText(PRODUCT_FINDER_MARKDOWN);
    expect(funds.map((fund) => fund.ticker)).toEqual(['SCHD', 'SCHJ', 'SCHK', 'SGVT', 'STCE']);
    const schj = funds.find((fund) => fund.ticker === 'SCHJ')!;
    expect(schj.name).toBe('Schwab 1-5 Year Corporate Bond ETF');
    expect(schj.category).toBe('Fixed Income');
    expect(schj.ter).toBe(0.03);
    expect(schj.grossTer).toBe(0.03);
    expect(schj.inception).toBe('2019-10-10');
    expect(schj.asOfDate).toBe('2026-08-27');
    expect(schj.fundPage).toBe('https://www.schwabassetmanagement.com/products/schj');
    const schk = funds.find((fund) => fund.ticker === 'SCHK')!;
    expect(schk.category).toBe('U.S. Equities');
    expect(schk.ter).toBe(0.03);
    expect(schk.inception).toBe('2017-10-11');
    const stce = funds.find((fund) => fund.ticker === 'STCE')!;
    expect(stce.category).toBe('Global Equities');
    expect(stce.name).toContain('Schwab Crypto Thematic');
    expect(funds.find((fund) => fund.ticker === 'SGVT')!.category).toBe('Money Market');
    expect(funds.find((fund) => fund.ticker === 'SCHD')!.ter).toBe(0.06);
  });

  test('reads the direct HTML rendering', () => {
    const funds = parseCatalogText(PRODUCT_FINDER_HTML);
    expect(funds.map((fund) => fund.ticker)).toEqual(['FNDE', 'SCHR', 'SCHX']);
    const schx = funds.find((fund) => fund.ticker === 'SCHX')!;
    expect(schx.name).toBe('Schwab U.S. Large-Cap ETF');
    expect(schx.category).toBe('U.S. Equities');
    expect(schx.ter).toBe(0.03);
    expect(schx.grossTer).toBeNull();
    expect(schx.inception).toBe('2009-11-03');
    const fnde = funds.find((fund) => fund.ticker === 'FNDE')!;
    expect(fnde.category).toBe('International Equities');
    expect(fnde.grossTer).toBe(0.39);
    expect(fnde.inception).toBe('2013-08-15');
  });

  test('throws when no fund rows are present', () => {
    expect(() => parseCatalogText('<html><body>Access denied</body></html>')).toThrow(/no ETF rows/);
  });
});

describe('Schwab product page parser', () => {
  test('reads the proxied markdown rendering', () => {
    const summary = parseProductPage(PRODUCT_PAGE_MARKDOWN, 'SCHO');
    expect(summary.name).toBe('Schwab Short-Term U.S. Treasury ETF');
    expect(summary.inception).toBe('2010-08-05');
    expect(summary.totalNetAssets).toBe(15_193_857_213.48);
    expect(summary.totalNetAssetsAsOfDate).toBe('2026-09-17');
    expect(summary.totalExpenseRatio).toBe(0.03);
    expect(summary.indexName).toBe('Bloomberg US Treasury 1-3 Year Index');
    expect(summary.sharesOutstanding).toBe(635_570_000);
    expect(summary.nav).toBe(23.91);
    expect(summary.navAsOfDate).toBe('2026-09-18');
    expect(summary.totalHoldings).toBe(96);
    expect(summary.totalHoldingsAsOfDate).toBe('2026-09-17');
    expect(summary.portfolioTurnover).toBe(63);
    expect(summary.morningstarCategory).toBe('Short Government');
    expect(summary.cusip).toBe('808524805');
    expect(summary.exchange).toBe('NYSE Arca, Inc.');
    expect(summary.secYield).toBe(3.62);
    expect(summary.secYieldAsOfDate).toBe('2026-09-17');
    expect(summary.distributionYield).toBe(3.91);
    expect(summary.distributionYieldAsOfDate).toBe('2026-08-31');
    expect(summary.premiumDiscount).toBe(-0.01);
    expect(summary.premiumDiscountAsOfDate).toBe('2026-09-18');
    expect(summary.bidAskMidpoint).toBe(23.91);
    expect(summary.holdingsCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_FundHoldings_2026-09-17.CSV');
    expect(summary.holdingsCsvAsOfDate).toBe('2026-09-17');
    expect(summary.distributionsCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_Fund_Distributions.CSV');
    expect(summary.navHistoryCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHO/SCHO_NAV_History.CSV');
    const monthly = summary.officialReturns.monthEnd.nav!;
    expect(monthly).toEqual({ asOfDate: '2026-08-31', mo1: 0.25, mo3: 0.43, ytd: 1.04, yr1: 2.47, cagr3y: 4.23, cagr5y: 1.92, cagr10y: 1.77, siAnn: 1.37 });
    expect(summary.officialReturns.monthEnd.marketPrice!.mo1).toBe(0.21);
    const quarterly = summary.officialReturns.quarterEnd.nav!;
    expect(quarterly).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 2.14, cagr3y: 4.0, cagr5y: 1.61, cagr10y: 1.71, siAnn: 1.34 });
    expect(summary.officialReturns.quarterEnd.marketPrice!.yr1).toBe(2.11);
  });

  test('reads the direct HTML rendering and relative CSV links', () => {
    const summary = parseProductPage(PRODUCT_PAGE_HTML, 'SCHD');
    expect(summary.name).toBe('Schwab U.S. Dividend Equity ETF');
    expect(summary.cusip).toBe('808524797');
    expect(summary.nav).toBe(33.66);
    expect(summary.navAsOfDate).toBe('2026-09-18');
    expect(summary.totalNetAssets).toBe(112_770_927_091.11);
    expect(summary.totalExpenseRatio).toBe(0.06);
    expect(summary.totalHoldings).toBe(102);
    expect(summary.indexName).toBe('Dow Jones U.S. Dividend 100™ Index');
    expect(summary.morningstarCategory).toBe('Large Value');
    expect(summary.secYield).toBe(3.25);
    expect(summary.distributionYield).toBe(3.0);
    expect(summary.premiumDiscount).toBe(0.03);
    expect(summary.bidAskMidpoint).toBe(33.88);
    expect(summary.holdingsCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_FundHoldings_2026-09-17.CSV');
    expect(summary.distributionsCsvUrl).toBe('https://www.schwabassetmanagement.com/sites/g/files/eyrktu361/files/product_files/SCHD/SCHD_Fund_Distributions.CSV');
    expect(summary.officialReturns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 4.28, mo3: 8.24, ytd: 29.31, yr1: 29.56, cagr3y: 16.21, cagr5y: 10.02, cagr10y: 13.18, siAnn: 13.67 });
    expect(summary.officialReturns.monthEnd.marketPrice!.ytd).toBe(29.29);
    expect(summary.officialReturns.quarterEnd.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 24.03, cagr3y: 13.52, cagr5y: 8.51, cagr10y: 12.37, siAnn: 13.09 });
  });

  test('parseFundName prefers the heading and tolerates the ticker prefix / title suffix', () => {
    expect(parseFundName('# Schwab U.S. Dividend Equity ETF\n\n## Schwab Market Talk', 'SCHD')).toBe('Schwab U.S. Dividend Equity ETF');
    expect(parseFundName('### SCHD Schwab U.S. Dividend Equity ETF', 'SCHD')).toBe('Schwab U.S. Dividend Equity ETF');
    expect(parseFundName('Title: SCHD Schwab U.S. Dividend Equity ETF | Schwab Asset Management', 'SCHD')).toBe('Schwab U.S. Dividend Equity ETF');
    expect(parseFundName('Title: Schwab Crypto Thematic Natural Language Processing ETF (formerly known as Schwab Crypto Thematic ETF)', 'STCE')).toBe('Schwab Crypto Thematic Natural Language Processing ETF (formerly known as Schwab Crypto Thematic ETF)');
    expect(parseFundName('## Schwab Market Talk\n\nAdvisors, join our monthly webcast', 'SCHD')).toBeNull();
  });

  test('young funds keep -- cells as null and missing sections as null', () => {
    const lines = toTextLines(['### Monthly', ' 08/31/2026', '| **SGVT NAV** |  | +0.35 | +1.05 | +2.90 | +4.30 | -- | -- | -- | +4.35 |'].join('\n'));
    const returns = parseOfficialReturns(lines, 'SGVT');
    expect(returns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 0.35, mo3: 1.05, ytd: 2.9, yr1: 4.3, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: 4.35 });
    expect(returns.monthEnd.marketPrice).toBeNull();
    expect(returns.quarterEnd.nav).toBeNull();
    const empty = parseProductPage('<html><body>Access denied</body></html>', 'SCHD');
    expect(empty.nav).toBeNull();
    expect(empty.cusip).toBe('');
    expect(empty.officialReturns.monthEnd.nav).toBeNull();
  });

  test('mergeOfficialReturns prefers official values but keeps the derived QTD', () => {
    const derived = { asOfDate: '2026-09-18', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const merged = mergeOfficialReturns(derived, { asOfDate: '2026-08-31', mo1: 0.25, mo3: 0.43, ytd: 1.04, yr1: 2.47, cagr3y: 4.23, cagr5y: null, cagr10y: 1.77, siAnn: 1.37 });
    expect(merged).toEqual({ asOfDate: '2026-08-31', mo1: 0.25, qtd: 2, ytd: 1.04, yr1: 2.47, cagr3y: 4.23, cagr5y: 6, cagr10y: 1.77, siAnn: 1.37 });
    expect(mergeOfficialReturns(derived, null)).toBe(derived);
  });

  test('metrics end with returnsBasis and performanceAsOf (official table date vs last Yahoo close)', () => {
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
});

describe('Schwab CSV exports', () => {
  test('parseCsv honours quotes, CRLF and drops blank lines', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n\r\n1,2')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]);
  });

  test('equity holdings: FIGI identifier, derived market value, cash row kept, trailer dropped', () => {
    const parsed = parseHoldingsCsv(EQUITY_HOLDINGS_CSV, 112_770_927_091.11);
    expect(parsed.headers).toEqual(['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category']);
    expect(parsed.asOfDate).toBe('2026-09-17');
    expect(parsed.bond).toBe(false);
    expect(parsed.rows.length).toBe(4);
    expect(parsed.rows[0]).toEqual({ Name: 'MERCK & CO INC', Ticker: 'MRK', Identifier: 'BBG000BPD257', Weight: '4.913717', 'Market Value': '5541243852.86', 'Shares Held': '37710468', 'Asset Category': 'Health Care' });
    expect(parsed.rows[1].Ticker).toBe('T'); // AT&T is a real exchange ticker in an equity fund
    expect(parsed.rows[2]).toEqual({ Name: 'US DOLLAR', Ticker: 'USD', Identifier: '-', Weight: '0.012372', 'Market Value': '13952136.16', 'Shares Held': '2832806.92', 'Asset Category': '-' });
    expect(parsed.rows[3].Ticker).toBe('-');
    expect(parsed.rows[3].Weight).toBe('0');
    const withoutAssets = parseHoldingsCsv(EQUITY_HOLDINGS_CSV, null);
    expect(withoutAssets.rows[0]['Market Value']).toBe('-');
  });

  test('bond holdings: generic symbols never become tickers; coupon/maturity columns added', () => {
    const parsed = parseHoldingsCsv(BOND_HOLDINGS_CSV, 15_193_857_213.48);
    expect(parsed.bond).toBe(true);
    expect(parsed.headers).toEqual(['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category', 'Coupon', 'Maturity']);
    expect(parsed.rows.length).toBe(4);
    for (const row of parsed.rows.slice(0, 3)) {
      expect(row.Ticker).toBe('-');
      expect(row.Identifier).toMatch(/^BBG/);
      expect(row['Asset Category']).toBe('Fixed Income');
    }
    expect(parsed.rows[0].Coupon).toBe('3.5');
    expect(parsed.rows[0].Maturity).toBe('01/31/2028');
    expect(parsed.rows[1].Identifier).toBe('BBG01KR4STF6'); // "T" symbol is a Treasury note here, not AT&T
    expect(parsed.rows[3]).toEqual({ Name: 'US DOLLAR', Ticker: 'USD', Identifier: '-', Weight: '0.08', 'Market Value': '12155085.77', 'Shares Held': '10000', 'Asset Category': '-', Coupon: '-', Maturity: '-' });
  });

  test('holdings CSV behind the proxy preamble still parses; missing header throws', () => {
    const parsed = parseHoldingsCsv(`Title: \n\nURL Source: x\n\nMarkdown Content:\n${EQUITY_HOLDINGS_CSV}`, null);
    expect(parsed.rows.length).toBe(4);
    expect(() => parseHoldingsCsv('<html>nope</html>')).toThrow(/header row not found/);
  });

  test('distributions: total distribution per share, ascending by ex-date, trailer dropped', () => {
    const rows = parseDistributionsCsv(DISTRIBUTIONS_CSV);
    expect(rows.length).toBe(5);
    expect(rows[0]).toEqual({ epoch: Date.UTC(2025, 5, 25) / 1000, amount: 0.2702 });
    expect(rows[4]).toEqual({ epoch: Date.UTC(2026, 5, 24) / 1000, amount: 0.2525 });
    expect(rows.every((row, index) => index === 0 || row.epoch > rows[index - 1].epoch)).toBe(true);
    expect(() => parseDistributionsCsv('nothing')).toThrow(/header row not found/);
  });
});

describe('distribution frequency', () => {
  const day = 86_400;
  const at = (iso: string) => ({ epoch: Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 1000, amount: 0.1 });

  test('monthly payers with a December special stay Monthly (median gap)', () => {
    const dividends = ['2025-08-01', '2025-09-02', '2025-10-01', '2025-11-03', '2025-12-01', '2025-12-19', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'].map(at);
    expect(inferDistributionFrequency(dividends)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
  });

  test('quarterly, semi-annual, annual, irregular, unknown and none', () => {
    expect(inferDistributionFrequency(['2025-03-26', '2025-06-25', '2025-09-24', '2025-12-10', '2026-03-25', '2026-06-24'].map(at))).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(inferDistributionFrequency(['2024-06-20', '2024-12-18', '2025-06-24', '2025-12-17', '2026-06-23'].map(at))).toEqual({ frequency: 'Semi-Annual', paymentsPerYear: 2 });
    expect(inferDistributionFrequency(['2023-12-20', '2024-12-18', '2025-12-17'].map(at))).toEqual({ frequency: 'Annual', paymentsPerYear: 1 });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }, { epoch: 900 * day, amount: 1 }])).toEqual({ frequency: 'Irregular', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });

  test('frequencyCodeLabel mirrors the client formatter', () => {
    expect(frequencyCodeLabel('Monthly')).toBe('01 - Monthly');
    expect(frequencyCodeLabel('Quarterly')).toBe('04 - Quarterly');
    expect(frequencyCodeLabel('Semi-Annual')).toBe('06 - Semi-annually');
    expect(frequencyCodeLabel('Annual')).toBe('12 - Annually');
    expect(frequencyCodeLabel('Irregular')).toBe('99 - Irregular');
    expect(frequencyCodeLabel('None')).toBe('00 - None');
    expect(frequencyCodeLabel('Unknown')).toBe('00 - Unknown');
    expect(frequencyCodeLabel('—')).toBe('00 - None');
    expect(frequencyCodeLabel('')).toBe('00 - None');
  });
});

describe('Yahoo chart', () => {
  const payload = {
    chart: {
      result: [{
        meta: { exchangeName: 'PCX', regularMarketPrice: 33.7, regularMarketTime: 1_789_000_000, firstTradeDate: 1_319_000_000 },
        timestamp: [1_600_000_000, 1_600_086_400, 1_600_172_800],
        indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
        events: { dividends: { '1600086400': { amount: 0.25, date: 1_600_086_400 } } },
      }],
    },
  };

  test('parseChart drops null closes and sorts dividends', () => {
    const chart = parseChart(payload);
    expect(chart.days.length).toBe(2);
    expect(chart.days[0]).toEqual({ date: '2020-09-13', close: 10, adjClose: 9, volume: 100 });
    expect(chart.dividends).toEqual([{ epoch: 1_600_086_400, amount: 0.25 }]);
    expect(chart.exchangeName).toBe('PCX');
    expect(() => parseChart({})).toThrow(/no result/);
  });

  test('priceReturns computes YTD and 1Y from adjusted closes', () => {
    const days = [
      { date: '2025-09-10', close: 100, adjClose: 100, volume: 0 },
      { date: '2025-12-31', close: 110, adjClose: 110, volume: 0 },
      { date: '2026-06-30', close: 115, adjClose: 115, volume: 0 },
      { date: '2026-09-17', close: 121, adjClose: 121, volume: 0 },
    ];
    const returns = priceReturns(days);
    expect(returns.asOfDate).toBe('2026-09-17');
    expect(returns.ytd).toBe(10);
    expect(returns.qtd).toBe(5.22);
    expect(returns.yr1).toBe(21);
    expect(returns.cagr3y).toBeNull();
  });
});

describe('SEC EDGAR fallback', () => {
  test('parseFundTickerMap maps tickers to series refs', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1454889, 'S000034073', 'C000104937', 'SCHD'], [1454889, 'S000027575', 'C000083337', 'SCHX']] });
    expect(map.get('SCHD')).toEqual({ cik: '0001454889', seriesId: 'S000034073', classId: 'C000104937' });
    expect(map.size).toBe(2);
  });

  test('parseEdgarAtomFilings keeps only original NPORT-P filings', () => {
    const atom = `<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1454889/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry><entry><content><accession-number>0001752724-26-000002</accession-number><filing-type>NPORT-P/A</filing-type></content></entry></feed>`;
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.length).toBe(1);
    expect(filings[0].url).toBe('https://www.sec.gov/Archives/edgar/data/1454889/000175272426000001/0001752724-26-000001.txt');
    expect(nportUrlFor('0001454889', '0001752724-26-000001')).toBe(filings[0].url);
  });

  test('parseNport reads holdings, debt attributes and net assets', () => {
    const xml = `<edgarSubmission><genInfo><regName>Schwab Strategic Trust</regName><regCik>0001454889</regCik><seriesName>Schwab U.S. Dividend Equity ETF</seriesName><seriesId>S000034073</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>112770927091.11</netAssets></fundInfo>
<invstOrSecs><invstOrSec><name>MERCK &amp; CO INC</name><cusip>58933Y105</cusip><balance>37710468</balance><valUSD>5541249108.24</valUSD><pctVal>4.91</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>UNITED STATES TREASURY NOTE</name><cusip>91282CJL6</cusip><balance>1000000</balance><valUSD>990000</valUSD><pctVal>0.5</pctVal><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.5</annualizedRt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`;
    const parsed = parseNport(xml);
    expect(parsed.seriesId).toBe('S000034073');
    expect(parsed.repPdDate).toBe('2026-06-30');
    expect(parsed.netAssets).toBe(112_770_927_091.11);
    expect(parsed.holdings.length).toBe(2);
    expect(parsed.holdings[0]).toEqual({ Name: 'MERCK & CO INC', Ticker: '-', Identifier: '58933Y105', Weight: '4.91', 'Market Value': '5541249108.24', 'Shares Held': '37710468', 'Asset Category': 'EC' });
    expect(parsed.holdings[1].Coupon).toBe('3.5');
    expect(parsed.holdings[1].Maturity).toBe('2028-01-31');
  });

  test('name normalization helpers', () => {
    expect(normalizeHoldingName('Merck & Co., Inc.')).toBe('MERCK AND');
    expect(normalizeHoldingName('Alphabet Inc. Class A')).toBe('ALPHABET CL A');
    expect(cleanHoldingTicker(' n/a ')).toBe('');
    expect(cleanHoldingTicker('brk.b')).toBe('BRK.B');
  });
});


import { test as frequencyLabelTest, expect as frequencyLabelExpect } from 'bun:test';
frequencyLabelTest('Frequency placeholders display None and existing cadence labels stay unchanged', async () => {
  const text = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const start = /^([ \t]*)function (formatDividendFrequency|formatDistributionFrequency)\(/m.exec(text);
  frequencyLabelExpect(start).not.toBeNull();
  const tail = text.slice(start!.index);
  const end = new RegExp('^' + start![1] + '\u007d', 'm').exec(tail);
  frequencyLabelExpect(end).not.toBeNull();
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end!.index + end![0].length));
  const format = new Function(js + '; return ' + start![2] + ';')();
  for (const value of [null, undefined, '', '  ', '-', '‐', '‑', '‒', '–', '—', ' — ']) {
    frequencyLabelExpect(format(value)).toBe('00 - None');
  }
  for (const [input, expected] of [
    ['None', '00 - None'], ['Unknown', '00 - Unknown'], ['Monthly', '01 - Monthly'],
    ['Quarterly', '04 - Quarterly'], ['Semi-annually', '06 - Semi-annually'],
    ['Annually', '12 - Annually'], ['Irregular', '99 - Irregular'],
  ]) frequencyLabelExpect(format(input)).toBe(expected);
});


import { test as queueTest, describe as queueDescribe, expect as queueExpect } from 'bun:test';

async function tickerChainHarness() {
 const app=await Bun.file(new URL('../app.tsx',import.meta.url)).text();
 const source=app.match(/^function withTickerChain<T>\([\s\S]*?^\}/m)?.[0];
 queueExpect(source).toBeDefined();
 const javascript=new Bun.Transpiler({loader:'ts'}).transformSync(source!);
 const chains=new Map<string,Promise<void>>();
 const enqueue=new Function('holdingsChains',`${javascript}; return withTickerChain;`)(chains) as
  <T>(ticker:string,fn:()=>Promise<T>)=>Promise<T>;
 return {chains,enqueue};
}

queueDescribe('per-ticker queue preserves caller results and stores completion-only promises',()=>{
 queueTest('successful generic result reaches caller, not the internal queue',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const value={rows:[['AGEM']]};
  queueExpect(await enqueue('AGEM',async()=>value)).toBe(value);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
 });
 queueTest('rejection reaches caller without poisoning the next queued task',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const error=new Error('page failed');
  const work=enqueue('AGEM',async()=>{throw error;});
  const observed=work.catch(reason=>reason);
  const settled=chains.get('AGEM');
  const next=enqueue('AGEM',async()=>42);
  queueExpect(await observed).toBe(error);
  queueExpect(await settled).toBeUndefined();
  queueExpect(await next).toBe(42);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
 });
 queueTest('synchronous callback throws also leave the queue usable',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const error=new Error('synchronous failure');
  queueExpect(await enqueue('AGEM',()=>{throw error;}).catch(reason=>reason)).toBe(error);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
  queueExpect(await enqueue('AGEM',async()=>'recovered')).toBe('recovered');
 });
 queueTest('same-ticker work stays serial while other tickers run independently',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const events:string[]=[];
  const first=enqueue('AGEM',async()=>{events.push('first');await gate;events.push('done');return 1;});
  const second=enqueue('AGEM',async()=>{events.push('second');return 2;});
  try {
   queueExpect(await enqueue('SGOL',async()=>3)).toBe(3);
   queueExpect(events).toEqual(['first']);
  } finally { release(); }
  queueExpect(await Promise.all([first,second])).toEqual([1,2]);
  queueExpect(events).toEqual(['first','done','second']);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
  queueExpect(await chains.get('SGOL')).toBeUndefined();
 });
});


import { test as headerTest, expect as headerExpect } from 'bun:test';
async function headerSummaryHarness() {
  const source = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const match = /^([ \t]*)function renderHeaderSummary\(/m.exec(source);
  headerExpect(match).not.toBeNull();
  const tail = source.slice(match!.index);
  const end = new RegExp('^' + match![1] + '}', 'm').exec(tail)!;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end.index + end[0].length));
  const makeNode = (text = ''): any => {
    const node: any = { textContent: text, childNodes: [], dataset: {}, listeners: {} };
    node.replaceChildren = (...children: any[]) => { node.childNodes = children; };
    node.append = (...children: any[]) => { node.childNodes.push(...children); };
    node.addEventListener = (name: string, listener: any) => { node.listeners[name] = listener; };
    return node;
  };
  const panel = makeNode(), subtitle = makeNode(), details = makeNode('Data: source link and updated timestamp');
  subtitle.append(details);
  const document = { getElementById: () => panel, createTextNode: makeNode, createElement: () => makeNode() };
  const render = new Function('document', js + '; return renderHeaderSummary;')(document);
  const text = () => subtitle.childNodes.map((n: any) => n.textContent).join('');
  return { render, panel, subtitle, details, makeNode, text };
}
headerTest('header has no visible subtitle without selection; original details nodes are retained', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe('');
  headerExpect(h.panel.childNodes).toEqual([h.details]);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('header shows sorted selected tickers only, preserving click activation and highlight', async () => {
  const h = await headerSummaryHarness(); const activated: string[] = [];
  h.render(h.subtitle, new Set(['ZZZ', 'AAA']), 'AAA', (ticker: string) => activated.push(ticker));
  headerExpect(h.text()).toBe('2 selected: AAA, ZZZ');
  const links = h.subtitle.childNodes.filter((n: any) => n.dataset.headerFund);
  headerExpect(links[0].className).toContain('underline');
  links[1].listeners.click({ preventDefault() {} });
  headerExpect(activated).toEqual(['ZZZ']);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('all selected still lists tickers; clear replaces both summary and selection', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(['CCC','AAA','BBB']), 'BBB', () => {});
  headerExpect(h.text()).toBe('3 selected: AAA, BBB, CCC');
  const next = h.makeNode('Fresh detail context'); h.subtitle.replaceChildren(next);
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe(''); headerExpect(h.panel.childNodes).toEqual([next]);
});
headerTest('header markup supplies a focusable counter and hidden rich panel with dismissal', async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
  headerExpect(html).toMatch(/<button[^>]*aria-controls="app-summary"[^>]*id="ticker-count"/);
  headerExpect(html).toContain('id="app-summary" role="region" aria-label="ETF catalog information" hidden');
  headerExpect(html).toContain("event.key !== 'Escape'");
  headerExpect(html).toContain("trigger.addEventListener('focus', show)");
  headerExpect(html).toContain("trigger.addEventListener('pointerenter'");
});


describe('return range defaults', () => {
  test('colon-only values do not create active return filters', () => {
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', TOTAL_RETURN_1Y: ':' }, 'PERFORMANCE')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Configuration: resolver, config file, README, --help and workflow parity
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = () => JSON.parse(read('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'SCHD' }, { CONCURRENCY: 3, TICKERS: 'SCHB' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('SCHB');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(resolveControls({ AUM: '1B:' }, {}, {}, { UNRELATED: 'x', PATH: '/bin' }).AUM).toBe('1B:');
});

test('blank input inherits the file value; advanced may deliberately blank a key', () => {
  expect(resolveControls({ TICKERS: 'SCHD' }, {}, { TICKERS: '' }).TICKERS).toBe('SCHD');
  expect(resolveControls({ TICKERS: 'SCHD' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ TICKERS: 'SCHD' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  const defaults = file();
  const scheduled = resolveControls(defaults, JSON.parse('{}'), {}, {});
  expect(scheduled).toEqual(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])));
});

test('resolver rejects unknown keys, invalid values, non-scalars and newline injection', () => {
  for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { SEC_YIELD: '5:1' }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'a:b' }, { TICKERS: ['SCHD'] }, { TICKERS: { a: 1 } }, null, []]) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, 'not an object')).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('Schwab-specific default values', () => {
  const config = readConfig(resolveControls(file()));
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(2);
  expect(config.concurrency).toBe(2);
  expect(config.holdingsPageSize).toBe(250);
  expect(config.historyPageSize).toBe(1000);
  expect(config.maxRetries).toBe(2);
  expect(config.historyRange).toBe('max');
  expect(config.edgarFallback).toBe(true);
  expect(config.skipSchwab).toBe(false);
  expect(config.skipYahoo).toBe(false);
  expect(config.maxRetries).toBeGreaterThanOrEqual(1);
  expect(config.storeRawDownloads).toBe(false);
  expect(config.tickers).toBeNull();
  expect(config.aum).toBeUndefined();
  expect(config.ter).toBeUndefined();
  expect(config.dividendYield).toBeUndefined();
  expect(config.performance).toEqual({});
  expect(config.totalReturn).toEqual({});
  expect(config.secYield).toBeUndefined();
  expect(file().SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
  expect(config.secUa).toBe('daggerok ETF feed daggerok@gmail.com');
  expect(readConfig(resolveControls(file(), { SEC_UA: 'My Feed me@example.org' })).secUa).toBe('My Feed me@example.org');
});

test('runtimeControls reads the config file and lets env override it', async () => {
  expect((await runtimeControls({})).REQUEST_SLEEP).toBe('2');
  expect((await runtimeControls({ REQUEST_SLEEP: '0', TICKERS: 'SCHD SCHB' })).TICKERS).toBe('SCHD SCHB');
});

test('config keys, CONTROL_NAMES, README and --help stay in sync', () => {
  expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
  for (const value of Object.values(file())) expect(typeof value).toBe('string');
  const doc = read('README.md');
  const section = doc.slice(doc.indexOf('### Update controls'), doc.indexOf('### Examples'));
  const documented = new Set<string>();
  for (const [, cell] of section.matchAll(/^\| ((?:`[A-Z0-9_]+`(?:, )?)+) \|/gm)) {
    const tokens = [...cell.matchAll(/`([A-Z0-9_]+)`/g)].map((m) => m[1]);
    const prefix = tokens[0].replace(/_YTD$/, '');
    for (const token of tokens) documented.add(token.startsWith('_') ? `${prefix}${token}` : token);
  }
  expect([...documented].sort()).toEqual([...CONTROL_NAMES].sort());
  expect(doc).toContain('scripts/update-data.config.json');
  const help = spawnSync('bun', [new URL('./update-data.ts', import.meta.url).pathname, '--help'], { encoding: 'utf8' }).stdout;
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_/);
    expect(help).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
  }
});

test('workflow: inputs, schedule, fixed output dir and no direct interpolation', () => {
  const yml = read('.github/workflows/update-data.yml');
  const block = yml.slice(yml.indexOf('    inputs:'), yml.indexOf('\npermissions:'));
  const names = [...block.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(block).toMatch(/advanced:[\s\S]*default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as any);
  expect(names).not.toContain('sec_ua');
  expect(names).not.toContain('output_dir');
  expect(yml).toContain("cron: '0 0 * * 0'");
  expect(yml).not.toMatch(/^  push:/m);
  expect(yml).toContain('toJSON(inputs)');
  expect(yml).not.toMatch(/\$\{\{\s*inputs\./);
  expect(yml).toContain('resolveControls');
  expect(yml).toContain('vars.SEC_UA');
  expect(yml).toContain('timeout-minutes: 30');
  expect(yml).toContain('persist-credentials: false');
  expect(yml).toContain('git add api/schwab\n');
  expect(yml.match(/git add /g)?.length).toBe(1);
  expect(yml).not.toContain('OUTPUT_DIR');
});

test('README structure and verification section', () => {
  const doc = read('README.md');
  const order = ['# Schwab', '## Using Bun', '## Updating the static Schwab data', '### Data sources', '### Metrics and caveats', '### Update controls', '### Examples', '## TypeScript and verification', '## Brands table', '## Sibling applications', '## License'];
  let at = -1;
  for (const heading of order) {
    const next = doc.indexOf(`\n${heading}\n`, at);
    expect(next > at || (heading === '# Schwab' && doc.startsWith(heading))).toBe(true);
    at = Math.max(at, next);
  }
  for (const command of ['bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts --outfile=/dev/null', 'git diff --check']) expect(doc).toContain(command);
});

test('USE_SYSTEM_CA control: auto/true/false, case-insensitive, strict, default auto', () => {
  expect(resolveControls(file()).USE_SYSTEM_CA).toBe('auto');
  for (const mode of ['auto', 'true', 'false', 'AUTO', 'True', 'FALSE']) expect(resolveControls(file(), {}, {}, { USE_SYSTEM_CA: mode }).USE_SYSTEM_CA).toBe(mode.toLowerCase());
  expect(() => resolveControls(file(), {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow('USE_SYSTEM_CA');
  expect(() => resolveControls({ USE_SYSTEM_CA: 'maybe' })).toThrow('USE_SYSTEM_CA');
});

test('isCertError recognizes untrusted-certificate errors only', () => {
  expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
  expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
  expect(isCertError(Object.assign(new Error('fetch failed'), { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }))).toBe(true);
  expect(isCertError(Object.assign(new Error('fetch failed'), { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
  expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
  expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
  expect(isCertError(null)).toBe(false);
});

test('installSystemCa wraps fetch only in auto mode and restarts once on cert errors', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const reexec = () => { calls += 1; return undefined as never; };
  try {
    installSystemCa('false', reexec, false);
    expect(globalThis.fetch).toBe(original);
    installSystemCa('auto', reexec, true);
    expect(globalThis.fetch).toBe(original);
    installSystemCa('true', reexec, true);
    expect(calls).toBe(0);
    installSystemCa('true', reexec, false);
    expect(calls).toBe(1);
    globalThis.fetch = original; // the real reexec never returns; a stub falls through to the wrapper

    calls = 0;
    globalThis.fetch = (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } }); }) as unknown as typeof fetch;
    const failing = globalThis.fetch;
    installSystemCa('auto', reexec, false);
    expect(globalThis.fetch).not.toBe(failing);
    await globalThis.fetch('https://example.invalid/');
    expect(calls).toBe(1);

    globalThis.fetch = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await expect(globalThis.fetch('https://example.invalid/')).rejects.toThrow('ECONNRESET');
    expect(calls).toBe(1);

    globalThis.fetch = (async () => new Response('ok')) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    expect(await (await globalThis.fetch('https://example.invalid/')).text()).toBe('ok');
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});
