// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { describe, expect, test } from 'bun:test';
import {
  annualizedToTotal,
  cleanHoldingTicker,
  distributionsCsvUrl,
  firstDate,
  firstNumber,
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
  parseFundTickerMap,
  parseHoldingsCsv,
  parseNport,
  parseOfficialReturns,
  parseProductPage,
  parseRange,
  priceReturns,
  proxyUrl,
  stripProxyPreamble,
  toIsoDate,
  toTextLines,
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
  '# SCHO Schwab Short-Term U.S. Treasury ETF',
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
  '| **Total Net Assets (as of 09/17/2026)** |  | $15,193,857,213.48 |',
  '| **Total Expense Ratio** |  | 0.030% |',
  '| **Index Name** |  | Bloomberg US Treasury 1-3 Year Index |',
  '| **Shares Outstanding** |  | 635,570,000 |',
  '| **NAV (as of 09/18/2026)** |  | $23.91 |',
  '| **Total Holdings (as of 09/17/2026)** |  | 96 |',
  '| **Portfolio Turnover Rate** |  | 63% |',
  '| **Morningstar Category** |  | Short Government |',
  '| **Management Style** |  | Passive |',
  '| **CUSIP** |  | 808524805 |',
  '| **Exchange** |  | NYSE Arca, Inc. |',
  '',
  '### Yields',
  '',
  '|  |  |  |  |',
  '| --- | --- | --- | --- |',
  '| **SEC Yield (30 Day)** |  | 3.62% | 09/17/2026 |',
  '| **Distribution Yield (TTM)** |  | 3.91% | 08/31/2026 |',
  '| **Average Yield to Maturity** |  | 3.55% | 09/17/2026 |',
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
    expect(frequencyCodeLabel('—')).toBe('00 - —');
    expect(frequencyCodeLabel('')).toBe('00 - —');
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
