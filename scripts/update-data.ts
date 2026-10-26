#!/usr/bin/env bun
// Bun provides Node-compatible fs/promises; node types are intentionally not required at runtime.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}


// Schwab U.S.-listed ETF static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/schwab/** from public issuer/SEC/market-data sources:
//
//   catalog       Schwab Asset Management product finder filtered to ETFs
//                 https://www.schwabassetmanagement.com/product-finder (33 ETFs)
//   product page  https://www.schwabassetmanagement.com/products/<ticker>
//                 (Fund Profile, yields, NAV/market-price total returns,
//                 links to the per-fund CSV exports)
//   holdings      the dated "Export All Holdings" CSV linked from the product
//                 page (SEC EDGAR Form N-PORT-P for the exact series when the
//                 CSV is unavailable; the previous run as the last resort)
//   distributions the "Export Data" distribution-history CSV (Yahoo dividend
//                 events as the fallback)
//   history       Yahoo Finance's public chart endpoint (daily close, adjusted
//                 close, volume, dividends, splits)
//
// Issuer requests are made directly with a browser-like User-Agent first; when
// the issuer answers a non-browser client with an error or a bot-wall page,
// the same public URL is read through the read-only r.jina.ai rendering proxy
// (identical to daggerok/WisdomTree). No user data or credentials are sent to
// the proxy. SEC and Yahoo requests stay direct.
//
// Usage: bun ./scripts/update-data.ts [--help]

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';

type JsonRecord = Record<string, any>;
type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

const SCHWAB_SITE = 'https://www.schwabassetmanagement.com';
const SCHWAB_CATALOG_URL = `${SCHWAB_SITE}/product-finder?combine=&field_product_solution_target_id%5B0%5D=291&field_product_solution_target_id%5B1%5D=291`;
const SCHWAB_PRODUCT_FILES = `${SCHWAB_SITE}/sites/g/files/eyrktu361/files/product_files`;
const PROXY_PREFIX = 'https://r.jina.ai/';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEC_SITE = 'https://www.sec.gov';
const SEC_BROWSE_URL = `${SEC_SITE}/cgi-bin/browse-edgar`;
const SEC_ARCHIVES = `${SEC_SITE}/Archives/edgar/data`;
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
const DEFAULT_SEC_UA = 'daggerok ETF feed daggerok@gmail.com';
let secUa = DEFAULT_SEC_UA; // overridden by the SEC_UA control when nonblank
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const FETCH_TIMEOUT_MS = 45_000; // covers headers and body
const PROXY_SLEEP_SECONDS = 3.2; // r.jina.ai anonymous tier is ~20 requests per minute

let API_ROOT = new URL('../api/schwab/', import.meta.url);
let INDEX_FILE = new URL('index.json', API_ROOT);
let STATE_FILE = new URL('update-state.json', API_ROOT);

/** Test hook: point the feed readers and writers at another directory (a trailing slash is added). */
export function useApiRoot(root: URL): URL {
  const previous = API_ROOT;
  API_ROOT = new URL(root.href.endsWith('/') ? root.href : `${root.href}/`);
  INDEX_FILE = new URL('index.json', API_ROOT);
  STATE_FILE = new URL('update-state.json', API_ROOT);
  return previous;
}

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
const BOND_HOLDINGS_HEADERS = [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const AUM_BOUNDS = { nano: [0, 10_000_000], micro: [10_000_000, 300_000_000], small: [300_000_000, 2_000_000_000], mid: [2_000_000_000, 10_000_000_000], large: [10_000_000_000, undefined] } as const;
const KNOWN_ASSET_CLASSES = ['Asset Allocation', 'Fixed Income', 'International Equities', 'Global Equities', 'Money Market', 'Real Estate', 'U.S. Equities'];

export type CatalogReturns = {
  ytd: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  ter: number | null;
  grossTer: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  /** Code of the definition behind dividendYield (see YIELD_BASIS_CODES); null while the yield is unknown or its origin is not recorded. */
  dividendYieldBasis?: YieldBasis | null;
  secYield: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  fundPage: string;
  source: 'schwab' | 'previous index' | 'seed';
};

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };
export type ParsedChart = {
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
  exchangeName: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
};

export type PriceReturns = {
  asOfDate: string;
  mo1: number | null;
  qtd: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

/** One row of the official performance table (NAV or Market Price basis). */
export type OfficialReturnRow = {
  asOfDate: string;
  mo1: number | null;
  mo3: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

export type OfficialReturns = {
  monthEnd: { nav: OfficialReturnRow | null; marketPrice: OfficialReturnRow | null };
  quarterEnd: { nav: OfficialReturnRow | null; marketPrice: OfficialReturnRow | null };
};

export type ProductPageSummary = {
  name: string | null;
  cusip: string;
  exchange: string;
  indexName: string;
  morningstarCategory: string;
  inception: string | null;
  nav: number | null;
  navAsOfDate: string | null;
  totalNetAssets: number | null;
  totalNetAssetsAsOfDate: string | null;
  totalExpenseRatio: number | null;
  sharesOutstanding: number | null;
  totalHoldings: number | null;
  totalHoldingsAsOfDate: string | null;
  portfolioTurnover: number | null;
  premiumDiscount: number | null;
  premiumDiscountAsOfDate: string | null;
  bidAskMidpoint: number | null;
  secYield: number | null;
  secYieldAsOfDate: string | null;
  distributionYield: number | null;
  distributionYieldAsOfDate: string | null;
  holdingsCsvUrl: string;
  holdingsCsvAsOfDate: string | null;
  distributionsCsvUrl: string;
  navHistoryCsvUrl: string;
  officialReturns: OfficialReturns;
  /** Which sections of the page are present at all (a heading or labelled row), whether or not their values parsed. */
  sections: PageSections;
  /** True only when Quote Details, the Fund Profile table and both performance tables (Monthly, Quarterly) are present: such a page has loaded fully. */
  loadedFully: boolean;
};

export type PageSections = { quote: boolean; profile: boolean; yields: boolean; recent: boolean; quarter: boolean };

export type HoldingsCsv = { headers: string[]; rows: JsonRecord[]; asOfDate: string | null; bond: boolean };
export type Distribution = { epoch: number; amount: number };


type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
  secYield?: Range;
  performance: RangeMap;
  totalReturn: RangeMap;
  concurrency: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: Set<string> | null;
  historyRange: string;
  edgarFallback: boolean;
  skipSchwab: boolean;
  skipYahoo: boolean;
  secUa: string;
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

// One pacing lane per concurrent worker (sized from config.concurrency in
// main()). A single shared gate capped total throughput at one request per
// requestSleepSeconds no matter how high CONCURRENCY was set; CONCURRENCY
// workers now each get their own paced lane, so concurrency actually
// multiplies throughput as documented instead of only overlapping wait time.
let requestGates: number[] = [0];
let proxyGateAt = 0;
let requestSleepSeconds = 1.5;
/** One run's SEC state: the two SEC ticker tables (each loaded once) and the N-PORT reader cache (submissions and documents). */
let secState: { funds: Promise<Map<string, NportSeriesRef>> | null; names: Promise<Map<string, string>> | null; reader: Map<string, unknown> } = { funds: null, names: null, reader: new Map() };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function decodeEntities(value: string): string {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    .replace(/&copy;/gi, '©')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(value: unknown): string {
  return decodeEntities(String(value ?? ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTicker(value: unknown): string {
  return cleanText(value).replace(/[^A-Za-z0-9.-]/g, '').toUpperCase();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = cleanText(value);
  if (!raw || ['-', '--', '—', 'n/a', 'na', 'null', 'none'].includes(raw.toLowerCase())) return null;
  const negative = /^\(.*\)$/.test(raw);
  const normalized = raw.replace(/[($,%\s]/g, '').replace(/[)]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * First number-looking token of a free-text cell, ignoring date tokens
 * ("09/18/2026 | $23.88" -> 23.88, "3.25% As of 09/17/2026" -> 3.25).
 */
export function firstNumber(value: unknown): number | null {
  const raw = cleanText(value).replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  const match = /(\(?[-+]?\$?\d[\d,]*(?:\.\d+)?%?\)?)/.exec(raw);
  return match ? numberOrNull(match[1]) : null;
}

/** First US or ISO date token of a free-text cell. */
export function firstDate(value: unknown): string | null {
  const raw = cleanText(value);
  const match = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? toIsoDate(match[1]) : null;
}

export function toIsoDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const short = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(raw);
  if (short) {
    const yy = Number(short[3]);
    return `${yy <= 69 ? 2000 + yy : 1900 + yy}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
  }
  // Month-name and other calendar dates: pure text, the same day in every time zone (shared calendar-dates block)
  return calendarIso(raw) ?? raw;
}

function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${match[3]} ${match[1]}`;
}

function formatUsDate(epoch: number): string {
  const date = new Date(epoch * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function isoToEpoch(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000);
}

function formatAumDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)} M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)} K`;
  return `$${value.toFixed(2)}`;
}

function parseBoolean(value: string | undefined): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseDecimal(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseRange(value: string, name = 'range'): Range | undefined {
  const raw = String(value ?? '').trim();
  if (!raw || raw === ':') return undefined;
  if ((raw.match(/:/g) || []).length !== 1) throw new Error(`${name}: colon is required exactly once (use min:max)`);
  const [left, right] = raw.split(':').map((part) => part.trim().replace(/[$%]/g, ''));
  const min = left === '' ? undefined : Number(left);
  const max = right === '' ? undefined : Number(right);
  if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) throw new Error(`${name}: bounds must be numbers`);
  if (min !== undefined && max !== undefined && min > max) throw new Error(`${name}: minimum must not exceed maximum`);
  return { min, max };
}

function parseAumBound(value: string): number | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw in AUM_BOUNDS) return AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS][0];
  const match = /^\$?([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/i.exec(raw);
  if (!match) throw new Error(`AUM: invalid bound "${value}"`);
  const multiplier: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  return Number(match[1]) * multiplier[match[2].toLowerCase()];
}

export function parseAumRange(value: string): Range | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ':') return undefined;
  if (!raw.includes(':') && raw in AUM_BOUNDS) {
    const [min, max] = AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS];
    return { min, max };
  }
  if ((raw.match(/:/g) || []).length !== 1) throw new Error('AUM: colon is required exactly once (or use a size preset)');
  const [left, right] = raw.split(':');
  const min = left ? parseAumBound(left) : undefined;
  let max = right ? parseAumBound(right) : undefined;
  // Presets on the right are exclusive upper bounds; the UI contract uses the
  // same convention as iShares/SPDR/Fidelity.
  if (right && right in AUM_BOUNDS) max = AUM_BOUNDS[right as keyof typeof AUM_BOUNDS][1];
  if (min !== undefined && max !== undefined && min > max) throw new Error('AUM: minimum must not exceed maximum');
  return { min, max };
}

export function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') {
      const parsed = parseRange(value, `${prefix}_${period}`);
      if (parsed && (parsed.min !== undefined || parsed.max !== undefined)) result[period] = parsed;
    }
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const raw = String(value ?? '').split(/[\s,;]+/).filter((part) => part.trim() !== '');
  const tickers = raw.map(sanitizeTicker).filter(Boolean);
  if (raw.length && tickers.length !== raw.length) throw new Error(`TICKERS: invalid ticker in "${String(value).trim()}"`);
  return tickers.length ? new Set(tickers) : null;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 1.5),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    secYield: parseRange(env.SEC_YIELD ?? ':', 'SEC_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, 3)),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000)),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: Math.max(1, parsePositiveInt(env.MAX_RETRIES, 2)),
    tickers: readTickerSet(env.TICKERS),
    historyRange: env.HISTORY_RANGE?.trim() || 'max',
    edgarFallback: !['0', 'false', 'off', 'no', 'n'].includes(String(env.EDGAR_FALLBACK ?? '1').trim().toLowerCase()),
    skipSchwab: parseBoolean(env.SKIP_SCHWAB),
    skipYahoo: parseBoolean(env.SKIP_YAHOO),
    secUa: env.SEC_UA?.trim() || DEFAULT_SEC_UA,
  };
}

function rangeMatches(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

function annualizedToTotal(value: number | null | undefined, years: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || years <= 0) return null;
  return round(((1 + value / 100) ** years - 1) * 100, 2);
}

export { annualizedToTotal };

// ---------------------------------------------------------------------------
// Text normalization: HTML and r.jina.ai markdown -> the same line/cell model
// ---------------------------------------------------------------------------

function absoluteUrl(href: string, base = SCHWAB_SITE): string {
  const raw = cleanText(href);
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return '';
  try {
    return new URL(raw, base).toString();
  } catch {
    return '';
  }
}

/**
 * Turns an HTML document into the same shape r.jina.ai produces: one text line
 * per block, table cells separated by pipes, anchors as `[label](url)`. Every
 * parser below works on this normalized text, so the direct HTML page and the
 * proxied markdown rendering are handled by one code path.
 */
export function htmlToText(html: string): string {
  let text = String(html ?? '');
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string, inner: string) => {
    const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
    const label = cleanText(inner.replace(/<[^>]+>/g, ' '));
    const url = href ? absoluteUrl(href[1] ?? href[2] ?? '') : '';
    return url && label ? ` [${label}](${url}) ` : ` ${label} `;
  });
  text = text.replace(/<title\b[^>]*>([\s\S]*?)<\/title>/i, (_match, inner: string) => `\nTitle: ${cleanText(inner)}\n`);
  text = text.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner: string) => `\n### ${cleanText(inner.replace(/<[^>]+>/g, ' '))}\n`);
  text = text.replace(/<tr\b[^>]*>/gi, '\n| ');
  text = text.replace(/<\/(td|th)>/gi, ' | ');
  text = text.replace(/<\/(tr|p|div|li|table|thead|tbody|section|article|ul|ol|dt|dd|header|footer|label|option|button|caption|figcaption)>/gi, '\n');
  text = text.replace(/<(p|div|li|table|section|article|ul|ol|dt|dd|header|footer|label|caption|figcaption)\b[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Strips the r.jina.ai preamble ("Title:", "URL Source:", "Markdown Content:"). */
export function stripProxyPreamble(text: string): string {
  const source = String(text ?? '');
  const marker = /^Markdown Content:\s*\n/m.exec(source);
  return marker ? source.slice(marker.index + marker[0].length) : source;
}

export type TextLine = { text: string; cells: string[] };

function stripMarkdown(value: string): string {
  return cleanText(
    String(value ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*(?:#{1,6}\s+|[*+-]\s+|\d+\.\s+)+/, ''),
  );
}

/** Splits normalized text into lines with their pipe-separated, markdown-free cells. */
export function toTextLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\|?\s*(?:-{2,}\s*\|\s*)+-{0,}\s*\|?$/.test(line)) continue; // markdown table separator
    const cells = line.split('|').map((cell) => stripMarkdown(cell)).filter(Boolean);
    lines.push({ text: stripMarkdown(line.replace(/\|/g, ' ')), cells });
  }
  return lines;
}

function normalizeLabel(value: string): string {
  return cleanText(value).replace(/[:：]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Finds a labelled value in the line model. Handles the three renderings seen
 * on schwabassetmanagement.com: a table row (`| Label | | value |`), a
 * heading followed by a `Fund Data value` line (the mobile list rendering) and
 * a `Label value` single line.
 */
export function lookupLabel(lines: TextLine[], label: string | RegExp): { value: string; labelText: string } | null {
  const matcher = (cell: string): boolean => {
    const normalized = normalizeLabel(cell);
    if (label instanceof RegExp) return label.test(cell);
    const wanted = normalizeLabel(label);
    return normalized === wanted || normalized.startsWith(`${wanted} (as of`) || normalized.startsWith(`${wanted} as of`);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const { cells } = lines[index];
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      if (!matcher(cells[cellIndex])) continue;
      const rest = cells.slice(cellIndex + 1).filter((cell) => !/^fund data$/i.test(cell));
      if (rest.length) return { value: rest.join(' | '), labelText: cells[cellIndex] };
      const next = lines[index + 1];
      if (next && next.cells.length && /^fund data\b/i.test(next.text)) {
        return { value: cleanText(next.text.replace(/^fund data\b/i, '')), labelText: cells[cellIndex] };
      }
      if (next && next.cells.length === 1 && !/[a-z]{3,}\s*\(?[a-z]*\)?$/i.test(next.text) && /\d/.test(next.text)) {
        return { value: next.text, labelText: cells[cellIndex] };
      }
      return { value: '', labelText: cells[cellIndex] };
    }
  }
  return null;
}

function labelAsOf(found: { value: string; labelText: string } | null): string | null {
  if (!found) return null;
  return firstDate(found.labelText) || firstDate(found.value) || null;
}

function labelNumber(found: { value: string; labelText: string } | null): number | null {
  return found ? firstNumber(found.value) : null;
}

function labelText(found: { value: string; labelText: string } | null): string {
  if (!found) return '';
  return cleanText(found.value.split('|')[0]);
}

function linkUrls(source: string, pattern: RegExp): string[] {
  const urls = new Set<string>();
  for (const match of String(source ?? '').matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) if (pattern.test(match[1])) urls.add(decodeEntities(match[1]));
  for (const match of String(source ?? '').matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    const url = absoluteUrl(match[1]);
    if (url && pattern.test(url)) urls.add(url);
  }
  return [...urls];
}

// ---------------------------------------------------------------------------
// Catalog: product finder (ETFs)
// ---------------------------------------------------------------------------

function canonicalFundPage(raw: string, ticker: string): string {
  const fallback = `${SCHWAB_SITE}/products/${ticker.toLowerCase()}`;
  if (!raw) return fallback;
  const absolute = absoluteUrl(raw);
  const match = /\/products\/([a-z0-9.-]+)/i.exec(absolute);
  return match ? `${SCHWAB_SITE}/products/${match[1].toLowerCase()}` : fallback;
}

function normalizeCategory(value: string): string {
  const raw = cleanText(value).replace(/\s*\/\s*$/, '');
  const known = KNOWN_ASSET_CLASSES.find((item) => item.toLowerCase() === raw.toLowerCase());
  return known || raw || 'ETF';
}

export function catalogAsOfDate(text: string): string | null {
  const match = /As of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(String(text ?? ''));
  return match ? toIsoDate(match[1]) : null;
}

/**
 * Parses the product finder (HTML or proxied markdown). Each fund appears as a
 * `[TICKER Fund Name](https://…/products/ticker)` link followed either by the
 * table cells (Product Type | Asset Class | Gross ER | Net ER | Inception) or
 * by the mobile list lines ("Asset Class Fixed Income", "Net Expense Ratio …").
 */
export function parseCatalogText(text: string): CatalogFund[] {
  const source = htmlToText(stripProxyPreamble(text));
  const lines = source.split('\n');
  const funds = new Map<string, CatalogFund>();
  const catalogDate = catalogAsOfDate(source);
  const linkPattern = /\[([A-Z][A-Z0-9.]{1,5})\s+([^\]]+?)\]\((https?:\/\/[^)\s]*\/products\/([a-z0-9.-]+))\)/g;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const match of line.matchAll(linkPattern)) {
      const ticker = sanitizeTicker(match[1]);
      if (!ticker || ticker.toLowerCase() !== match[4].toLowerCase()) continue;
      const name = cleanText(match[2].replace(/\*\*/g, ''));
      const after = line.slice((match.index ?? 0) + match[0].length);
      const cells = after.split('|').map((cell) => stripMarkdown(cell)).filter(Boolean);
      let category = '';
      let grossTer: number | null = null;
      let ter: number | null = null;
      let inception = '';
      if (cells.length >= 4) {
        const typeIndex = cells.findIndex((cell) => /^etfs?$/i.test(cell));
        const base = typeIndex >= 0 ? typeIndex + 1 : 0;
        category = cells[base] || '';
        // Gross ER is blank for several U.S. equity rows: the cells collapse,
        // so read the percentages and the date by shape, not by position.
        const percents = cells.slice(base + 1).filter((cell) => /^\d+(?:\.\d+)?%$/.test(cell));
        const dates = cells.slice(base + 1).filter((cell) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell));
        if (percents.length >= 2) { grossTer = numberOrNull(percents[0]); ter = numberOrNull(percents[1]); }
        else if (percents.length === 1) ter = numberOrNull(percents[0]);
        inception = dates[0] || '';
      }
      if (!category || ter === null || !inception) {
        const nearby = lines.slice(index, index + 6).join('\n');
        if (!category) category = /Asset Class\s+([A-Za-z.\s]+?)(?:\s+As of|\n|$)/i.exec(nearby)?.[1] || '';
        if (ter === null) ter = numberOrNull(/Net Expense Ratio\*?\s*([\d.]+%)/i.exec(nearby)?.[1] ?? null);
        if (grossTer === null) grossTer = numberOrNull(/Gross Expense Ratio\s*([\d.]+%)/i.exec(nearby)?.[1] ?? null);
        if (!inception) inception = /Inception Date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(nearby)?.[1] || '';
      }
      const existing = funds.get(ticker);
      const fund: CatalogFund = existing || {
        ticker,
        name,
        category: 'ETF',
        categoryPath: '',
        inception: null,
        exchange: '',
        cusip: '',
        isin: '',
        benchmark: '',
        ter: null,
        grossTer: null,
        nav: null,
        close: null,
        premiumDiscount: null,
        netAssets: null,
        dividendYield: null,
        secYield: null,
        asOfDate: catalogDate,
        returns: { ...EMPTY_RETURNS },
        fundPage: canonicalFundPage(match[3], ticker),
        source: 'schwab',
      };
      if (name.length > fund.name.length) fund.name = name;
      if (category) { fund.category = normalizeCategory(category); fund.categoryPath = fund.category; }
      if (ter !== null) fund.ter = ter;
      if (grossTer !== null) fund.grossTer = grossTer;
      if (inception) fund.inception = toIsoDate(inception) || fund.inception;
      funds.set(ticker, fund);
    }
  }
  if (!funds.size) throw new Error('Schwab product finder: no ETF rows found');
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

export async function paceRequests(proxy = false): Promise<void> {
  const now = Date.now();
  if (proxy) {
    const wait = Math.max(0, proxyGateAt - now);
    proxyGateAt = Math.max(now, proxyGateAt) + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
    if (wait) await sleep(wait);
    return;
  }
  let lane = 0;
  for (let i = 1; i < requestGates.length; i++) if (requestGates[i] < requestGates[lane]) lane = i;
  const wait = Math.max(0, requestGates[lane] - now);
  requestGates[lane] = Math.max(now, requestGates[lane]) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
}

/** Pacing setup shared by main() and the offline concurrency test. */
export function configurePacing(sleepSeconds: number, concurrency: number): void {
  requestSleepSeconds = sleepSeconds;
  requestGates = new Array(Math.max(1, concurrency)).fill(0);
  proxyGateAt = 0;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function retryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 403 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  return true;
}

function isProxyUrl(url: string): boolean {
  return url.startsWith(PROXY_PREFIX);
}

export function proxyUrl(url: string): string {
  return `${PROXY_PREFIX}${url}`;
}

export async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  // the rate-limited rendering proxy is retried at most once
  const maxRetries = proxy ? Math.min(config.maxRetries, 1) : config.maxRetries;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await paceRequests(proxy);
      const response = await fetch(url, { headers: { 'User-Agent': secUa, Accept: '*/*', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        const snippet = cleanText((await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ')).slice(0, 160);
        throw new HttpError(response.status, `${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !retryable(error)) break;
      const rateLimited = error instanceof HttpError && error.status === 429;
      await sleep(Math.min(60_000, (rateLimited ? 12_000 : 800) * 2 ** attempt));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fetchJson(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<JsonRecord> {
  const text = await fetchText(url, label, config, { Accept: 'application/json', ...headers });
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response was not JSON`);
  }
}

let issuerDirectDenials = 0;
const ISSUER_DIRECT_DENIAL_LIMIT = 2;

/**
 * Issuer documents: one direct request with a browser-like User-Agent first,
 * then the same public URL through the read-only rendering proxy. The issuer
 * CDN answers datacenter clients with "Access Denied" (HTTP 403); after two
 * such denials in a run the direct attempt is skipped to keep the run short.
 * The proxy itself sits behind Cloudflare and challenges browser User-Agents,
 * so proxy requests declare the plain feed User-Agent. `validate` rejects
 * bot-wall/HTML error pages so that the fallback is taken instead of parsing
 * garbage.
 */
async function fetchIssuerText(url: string, label: string, config: UpdaterConfig, validate: (text: string) => boolean, accept = 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', options: { cache?: boolean } = {}): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  let lastError: unknown = new Error('direct request skipped (issuer CDN denies this network)');
  if (issuerDirectDenials < ISSUER_DIRECT_DENIAL_LIMIT) {
    try {
      const text = await fetchText(url, label, { ...config, maxRetries: 0 }, { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' });
      if (validate(text)) {
        issuerDirectDenials = 0;
        return { text, via: 'direct' };
      }
      lastError = new Error('direct response did not contain the expected content');
    } catch (error) {
      lastError = error;
      if (/\b403\b/.test(error instanceof Error ? error.message : String(error))) {
        issuerDirectDenials += 1;
        if (issuerDirectDenials === ISSUER_DIRECT_DENIAL_LIMIT) outputNote(`[ ${'issuer'.padEnd(9)}] direct requests are denied from this network; using the read-only rendering proxy for the rest of the run`);
      }
    }
  }
  try {
    const headers: Record<string, string> = { 'User-Agent': secUa, Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8' };
    if (options.cache === false) headers['X-No-Cache'] = 'true';
    const text = stripProxyPreamble(await fetchText(proxyUrl(url), `${label} (proxy)`, config, headers));
    if (validate(text)) return { text, via: 'proxy' };
    throw new Error('proxy response did not contain the expected content');
  } catch (error) {
    const first = lastError instanceof Error ? lastError.message : String(lastError);
    const second = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${first}; ${second}`);
  }
}

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------

function emptyReturnRow(asOfDate = ''): OfficialReturnRow {
  return { asOfDate, mo1: null, mo3: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };
}

function returnRowFromCells(values: Array<number | null>, asOfDate: string, kind: 'monthly' | 'quarterly'): OfficialReturnRow {
  const row = emptyReturnRow(asOfDate);
  if (kind === 'monthly') {
    [row.mo1, row.mo3, row.ytd, row.yr1, row.cagr3y, row.cagr5y, row.cagr10y, row.siAnn] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => values[i] ?? null);
  } else {
    [row.yr1, row.cagr3y, row.cagr5y, row.cagr10y, row.siAnn] = [0, 1, 2, 3, 4].map((i) => values[i] ?? null);
  }
  return row;
}

/**
 * Reads the Performance section: a `Monthly` block (1 Month, 3 Month, YTD
 * cumulative; 1/3/5/10 Year, Inception annualized) and a `Quarterly` block
 * (1/3/5/10 Year, Inception annualized), each with `<TICKER> NAV` and
 * `<TICKER> Market Price` rows and an as-of date right after the heading.
 */
export function parseOfficialReturns(lines: TextLine[], ticker: string): OfficialReturns {
  const result: OfficialReturns = { monthEnd: { nav: null, marketPrice: null }, quarterEnd: { nav: null, marketPrice: null } };
  let section: 'monthly' | 'quarterly' | null = null;
  let sectionDate = '';
  const navLabel = `${ticker} nav`.toLowerCase();
  const marketLabel = `${ticker} market price`.toLowerCase();
  for (const line of lines) {
    const first = (line.cells[0] || '').toLowerCase();
    if (line.cells.length === 1 && (first === 'monthly' || first === 'quarterly')) {
      section = first as 'monthly' | 'quarterly';
      sectionDate = '';
      continue;
    }
    if (section && !sectionDate && line.cells.length === 1 && /^(as of\s+)?\d{1,2}\/\d{1,2}\/\d{4}$/i.test(line.text)) {
      sectionDate = toIsoDate(firstDate(line.text));
      continue;
    }
    if (first !== navLabel && first !== marketLabel) continue;
    const values = line.cells.slice(1).map((cell) => (/^[-+]?\d|^--$|^-$/.test(cell) ? numberOrNull(cell) : undefined)).filter((value) => value !== undefined) as Array<number | null>;
    if (values.length < 5) continue;
    const kind: 'monthly' | 'quarterly' = section || (values.length >= 8 ? 'monthly' : 'quarterly');
    const target = kind === 'monthly' ? result.monthEnd : result.quarterEnd;
    const row = returnRowFromCells(values, sectionDate, kind);
    if (first === navLabel) { if (!target.nav) target.nav = row; }
    else if (!target.marketPrice) target.marketPrice = row;
  }
  return result;
}

/**
 * Official fund name: the page heading (`# Schwab … ETF`, with or without the
 * ticker prefix) first, then the document title (which carries a site suffix).
 */
export function parseFundName(source: string, ticker: string): string | null {
  const upper = ticker.toUpperCase();
  const patterns = [
    new RegExp(`^#{1,3}\\s+(?:\\*\\*)?(?:${upper}\\s+)?(Schwab[^\\n|]*?\\bETF\\b[^\\n|]*)$`, 'im'),
    new RegExp(`^Title:\\s*(?:${upper}\\s+)?(Schwab[^\\n|]*?\\bETF\\b[^\\n|]*)`, 'im'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const cleaned = cleanText(match[1].replace(/\*\*/g, '')).replace(/\s*Schwab Asset Management$/i, '');
    if (cleaned) return cleaned;
  }
  return null;
}

export function parseProductPage(text: string, ticker: string): ProductPageSummary {
  const source = htmlToText(stripProxyPreamble(text));
  const lines = toTextLines(source);
  const upper = ticker.toUpperCase();
  const name = parseFundName(source, upper);
  const inception = lookupLabel(lines, 'Fund Inception');
  const netAssets = lookupLabel(lines, 'Total Net Assets');
  const ter = lookupLabel(lines, 'Total Expense Ratio');
  const indexName = lookupLabel(lines, 'Index Name');
  const shares = lookupLabel(lines, 'Shares Outstanding');
  const nav = lookupLabel(lines, 'NAV');
  const totalHoldings = lookupLabel(lines, 'Total Holdings');
  const turnover = lookupLabel(lines, 'Portfolio Turnover Rate') || lookupLabel(lines, 'Portfolio Turnover');
  const morningstar = lookupLabel(lines, 'Morningstar Category');
  const cusip = lookupLabel(lines, 'CUSIP');
  const exchange = lookupLabel(lines, 'Exchange');
  const secYield = lookupLabel(lines, 'SEC Yield (30 Day)') || lookupLabel(lines, /^SEC Yield\s*\(30[- ]Day\)/i) || lookupLabel(lines, '30 Day SEC Yield');
  const distributionYield = lookupLabel(lines, 'Distribution Yield (TTM)') || lookupLabel(lines, /^Distribution Yield\s*\(TTM\)/i);
  const premium = lines.find((line) => /^Premium\/Discount\b/i.test(line.cells[0] || '') && /[-+]?\d+(?:\.\d+)?%/.test(line.text));
  const midpoint = lines.find((line) => /^Bid\/Ask Midpoint\b/i.test(line.cells[0] || '') && /\$?\d/.test(line.text));
  const holdingsCsv = linkUrls(text, /_FundHoldings_\d{4}-\d{2}-\d{2}\.csv$/i)[0] || '';
  const distributionsCsv = linkUrls(text, /_Fund_Distributions\.csv$/i)[0] || '';
  const navHistoryCsv = linkUrls(text, /_NAV_History\.csv$/i)[0] || '';
  const officialReturns = parseOfficialReturns(lines, upper);
  // Page-loaded check: Quote Details (Premium/Discount and Bid/Ask Midpoint rows), the Fund Profile table (NAV and Total Net
  // Assets rows) and both performance tables (a Monthly and a Quarterly heading, or their parsed NAV rows) must be present.
  // A page missing any of them came back partial (rendering proxy), so what it lacks is unknown, not an honest absence.
  const heading = (name: string) => lines.some((line) => line.cells.length === 1 && line.cells[0].toLowerCase() === name);
  const sections: PageSections = {
    quote: lines.some((line) => /^Premium\/Discount\b/i.test(line.cells[0] || '')) && lines.some((line) => /^Bid\/Ask Midpoint\b/i.test(line.cells[0] || '')),
    profile: nav !== null && netAssets !== null,
    yields: secYield !== null || distributionYield !== null || heading('yields'),
    recent: heading('monthly') || officialReturns.monthEnd.nav !== null,
    quarter: heading('quarterly') || officialReturns.quarterEnd.nav !== null,
  };
  const cusipText = labelText(cusip).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return {
    name,
    cusip: /^[A-Z0-9]{9}$/.test(cusipText) ? cusipText : '',
    exchange: labelText(exchange),
    indexName: labelText(indexName),
    morningstarCategory: labelText(morningstar),
    inception: firstDate(labelText(inception)) || null,
    nav: labelNumber(nav),
    navAsOfDate: labelAsOf(nav),
    totalNetAssets: labelNumber(netAssets),
    totalNetAssetsAsOfDate: labelAsOf(netAssets),
    totalExpenseRatio: labelNumber(ter),
    sharesOutstanding: labelNumber(shares),
    totalHoldings: labelNumber(totalHoldings),
    totalHoldingsAsOfDate: labelAsOf(totalHoldings),
    portfolioTurnover: labelNumber(turnover),
    premiumDiscount: premium ? numberOrNull(/([-+]?\d+(?:\.\d+)?)%/.exec(premium.text)?.[1] ?? null) : null,
    premiumDiscountAsOfDate: premium ? firstDate(premium.text) : null,
    bidAskMidpoint: midpoint ? numberOrNull(/\$?(\d[\d,]*(?:\.\d+)?)/.exec(midpoint.text.replace(/^Bid\/Ask Midpoint/i, ''))?.[1] ?? null) : null,
    secYield: labelNumber(secYield),
    secYieldAsOfDate: labelAsOf(secYield),
    distributionYield: labelNumber(distributionYield),
    distributionYieldAsOfDate: labelAsOf(distributionYield),
    holdingsCsvUrl: holdingsCsv,
    holdingsCsvAsOfDate: holdingsCsv ? toIsoDate(/_FundHoldings_(\d{4}-\d{2}-\d{2})/i.exec(holdingsCsv)?.[1] || '') || null : null,
    distributionsCsvUrl: distributionsCsv,
    navHistoryCsvUrl: navHistoryCsv,
    officialReturns,
    sections,
    loadedFully: sections.quote && sections.profile && sections.recent && sections.quarter,
  };
}

// ---------------------------------------------------------------------------
// CSV exports: holdings and distributions
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function csvColumn(headers: string[], ...patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(header));
    if (index >= 0) return index;
  }
  return -1;
}

function plainNumber(value: unknown, digits: number): string {
  const parsed = numberOrNull(value);
  return parsed === null ? '-' : String(round(parsed, digits));
}

/** Market identifier codes of U.S. trading venues (the holdings CSV Exchange column). */
const US_VENUES = new Set(['XNYS', 'XNAS', 'XNGS', 'XNMS', 'XNCM', 'ARCX', 'BATS', 'BATY', 'EDGA', 'EDGX', 'IEXG', 'XASE', 'XCBO', 'XCHI', 'XCIS', 'XPHL', 'XBOS']);

/**
 * The holdings CSV gives the LOCAL exchange symbol of a foreign listing without its exchange: FNDF lists `SAN` for Banco Santander
 * (XMAD) and for Sanofi (XPAR), `T` for Telus (XTSE) next to AT&T in U.S. funds. The Watchlist groups positions by ticker, so a symbol
 * is published only for a U.S. listing (a U.S. venue, or a U.S. country with no or an OTC venue: U.S. dollar cash, futures); a foreign
 * listing gets Ticker '-' and keeps its BBG FIGI as Identifier. ADRs on NYSE or Nasdaq keep their symbol. No Exchange and no Country
 * column keeps every symbol.
 */
export function isUsListing(exchange: string, country: string): boolean {
  const venue = exchange.trim().toUpperCase(), home = country.trim().toUpperCase();
  if (US_VENUES.has(venue)) return true;
  return home === 'US' || (!venue && !home);
}

export function isHoldingsCsv(text: string): boolean {
  return /^\s*"?As-Of-Date"?\s*,\s*"?Symbol"?/i.test(String(text ?? '').replace(/^\uFEFF/, ''));
}

export function isDistributionsCsv(text: string): boolean {
  return /^\s*"?Ex[- ]?Date"?\s*,/i.test(String(text ?? '').replace(/^\uFEFF/, ''));
}

/**
 * Converts the issuer holdings CSV into the sibling sheet contract. Market
 * Value is derived (Percent of Assets x Total Net Assets) because the CSV
 * publishes weights only; bond rows keep `Ticker: "-"` because their Symbol
 * column carries generic instrument labels (TNOTE, T, WIT, …), not exchange
 * tickers, and they must never collide with real equities in the Watchlist.
 */
export function parseHoldingsCsv(text: string, netAssets: number | null = null): HoldingsCsv {
  const table = parseCsv(stripProxyPreamble(text));
  const headerIndex = table.findIndex((row) => /^as-of-date$/i.test(cleanText(row[0])));
  if (headerIndex < 0) throw new Error('holdings CSV: header row not found');
  const headers = table[headerIndex].map((cell) => cleanText(cell));
  const col = {
    date: csvColumn(headers, /^as-of-date$/i),
    symbol: csvColumn(headers, /^symbol$/i, /^ticker$/i),
    quantity: csvColumn(headers, /^quantity$/i, /^shares/i),
    weight: csvColumn(headers, /^percent of assets$/i, /weight/i),
    name: csvColumn(headers, /^name$/i, /^security name$/i),
    figi: csvColumn(headers, /^bbg figi$/i, /figi/i),
    cusip: csvColumn(headers, /^cusip$/i),
    sector: csvColumn(headers, /^sector$/i),
    coupon: csvColumn(headers, /^coupon rate$/i, /^coupon$/i),
    maturity: csvColumn(headers, /^maturity date$/i, /^maturity$/i),
    exchange: csvColumn(headers, /^exchange$/i),
    country: csvColumn(headers, /^country$/i),
  };
  // A renamed or dropped Name or Symbol column would publish '-' for every name or ticker over good data: refuse the sheet so the next
  // source is tried. A missing weight column parses to '-' weights, which the shared holdings guard rejects (fund kept, reported failed).
  const missing = (['name', 'symbol'] as const).filter((key) => col[key] < 0);
  if (missing.length) throw new Error(`holdings CSV: no ${missing.join(', ')} column`);
  const bond = col.maturity >= 0 || col.coupon >= 0;
  const rows: JsonRecord[] = [];
  let asOfDate: string | null = null;
  const at = (row: string[], index: number): string => (index >= 0 ? cleanText(row[index]) : '');
  for (const row of table.slice(headerIndex + 1)) {
    const date = toIsoDate(at(row, col.date));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // disclaimer trailer lines
    if (!asOfDate) asOfDate = date;
    const name = at(row, col.name) || '-';
    const maturity = at(row, col.maturity);
    const symbolRaw = at(row, col.symbol).toUpperCase();
    const isBondRow = bond && (Boolean(maturity) || at(row, col.coupon) !== '');
    const local = !isUsListing(at(row, col.exchange), at(row, col.country));
    const symbol = isBondRow || local || !symbolRaw || ['-', '--', 'N/A', 'NA', 'NONE', 'NULL'].includes(symbolRaw) ? '-' : symbolRaw;
    const figi = at(row, col.figi).toUpperCase();
    const cusip = at(row, col.cusip).toUpperCase();
    const weight = numberOrNull(at(row, col.weight));
    const marketValue = weight !== null && netAssets !== null ? String(round(weight / 100 * netAssets, 2)) : '-';
    const item: JsonRecord = {
      Name: name,
      Ticker: symbol,
      Identifier: figi || cusip || '-',
      Weight: weight === null ? '-' : String(round(weight, 6)),
      'Market Value': marketValue,
      'Shares Held': plainNumber(at(row, col.quantity), 4),
      'Asset Category': at(row, col.sector) || (isBondRow ? 'Fixed Income' : '-'),
    };
    if (bond) {
      item.Coupon = at(row, col.coupon) ? plainNumber(at(row, col.coupon), 4) : '-';
      item.Maturity = maturity || '-';
    }
    rows.push(item);
  }
  return { headers: bond ? BOND_HOLDINGS_HEADERS : HOLDINGS_HEADERS, rows, asOfDate, bond };
}

/** Distribution history CSV -> ascending {epoch, amount} list (Total Distribution per share). */
export function parseDistributionsCsv(text: string): Distribution[] {
  const table = parseCsv(stripProxyPreamble(text));
  const headerIndex = table.findIndex((row) => /^ex[- ]?date$/i.test(cleanText(row[0])));
  if (headerIndex < 0) throw new Error('distributions CSV: header row not found');
  const headers = table[headerIndex].map((cell) => cleanText(cell));
  const dateIndex = csvColumn(headers, /^ex[- ]?date$/i);
  const totalIndex = csvColumn(headers, /^total distribution/i, /^total$/i);
  const parts = ['income', 'short', 'long', 'return of capital'].map((label) => headers.findIndex((header) => header.toLowerCase().includes(label)));
  const result: Distribution[] = [];
  for (const row of table.slice(headerIndex + 1)) {
    const iso = toIsoDate(cleanText(row[dateIndex]));
    const epoch = isoToEpoch(iso);
    if (epoch === null) continue;
    let amount = totalIndex >= 0 ? numberOrNull(row[totalIndex]) : null;
    if (amount === null) {
      const sum = parts.map((index) => (index >= 0 ? numberOrNull(row[index]) : null)).filter((value): value is number => value !== null);
      amount = sum.length ? sum.reduce((acc, value) => acc + value, 0) : null;
    }
    if (amount === null || amount <= 0) continue;
    result.push({ epoch, amount: round(amount, 6) });
  }
  result.sort((a, b) => a.epoch - b.epoch);
  return result;
}

/** Dated holdings CSV candidates when the product page did not expose the link. */
export function holdingsCsvCandidates(ticker: string, asOfDate: string | null, now = new Date()): string[] {
  const upper = ticker.toUpperCase();
  const dates: string[] = [];
  if (asOfDate) dates.push(asOfDate);
  for (let back = 0; back < 10 && dates.length < 6; back += 1) {
    const day = new Date(now.getTime() - back * 86_400_000);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const iso = day.toISOString().slice(0, 10);
    if (!dates.includes(iso)) dates.push(iso);
  }
  return dates.map((date) => `${SCHWAB_PRODUCT_FILES}/${upper}/${upper}_FundHoldings_${date}.CSV`);
}

export function distributionsCsvUrl(ticker: string): string {
  const upper = ticker.toUpperCase();
  return `${SCHWAB_PRODUCT_FILES}/${upper}/${upper}_Fund_Distributions.CSV`;
}

/** ISIN for a U.S. CUSIP: `US` + CUSIP + Luhn check digit (labelled derived in meta.json). */
export function isinFromCusip(cusip: string): string {
  const base = cleanText(cusip).toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(base)) return '';
  const digits = `US${base}`.split('').map((char) => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55))).join('');
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) { value *= 2; if (value > 9) value -= 9; }
    sum += value;
    double = !double;
  }
  return `US${base}${(10 - (sum % 10)) % 10}`;
}

// ---------------------------------------------------------------------------
// SEC EDGAR Form N-PORT-P fallback: the shared nport-reader block at the end of this file finds, reads and checks the filing
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { 'User-Agent': secUa, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

/** A fresh SEC state for a run (main and tests). */
export function resetSecState(): void {
  secState = { funds: null, names: null, reader: new Map() };
}

/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  if (!secState.funds) {
    const loading = fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config, secHeaders()).then((payload) => parseSecFundTickers(payload));
    secState.funds = loading;
    loading.catch(() => { if (secState.funds === loading) secState.funds = null; });
  }
  return secState.funds;
}

/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run. */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  if (!secState.names) {
    const loading = fetchJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config, secHeaders()).then((payload) => parseSecCompanyNames(payload));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names;
}

/**
 * The Schwab holdings sheet of an N-PORT filing: HOLDINGS_HEADERS, plus Coupon and Maturity when the filing holds debt. A
 * missing number stays empty (never 0), a missing text is '-'; tickers come from nportTickers (U.S. equities only).
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): { headers: string[]; rows: JsonRecord[] } {
  const debt = filing.positions.some((position) => Boolean(position.maturity) || position.coupon !== null);
  const rows = filing.positions.map((position, index) => ({
    Name: position.name || '-',
    Ticker: tickers[index] || '-',
    Identifier: nportIdentifier(position) || '-',
    Weight: nportCell(position.weight),
    'Market Value': nportCell(position.value, 2),
    'Shares Held': nportCell(position.balance),
    'Asset Category': position.assetCat || '-',
    ...(debt ? { Coupon: nportCell(position.coupon), Maturity: position.maturity || '-' } : {}),
  }));
  return { headers: debt ? BOND_HOLDINGS_HEADERS : HOLDINGS_HEADERS, rows };
}

// ---------------------------------------------------------------------------
// Yahoo Finance chart: history, dividends, derived returns
// ---------------------------------------------------------------------------

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart returned no result');
  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = numberOrNull(quote.close?.[i]);
    if (close === null) continue;
    const adjClose = numberOrNull(adjusted[i]) ?? close;
    days.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close, adjClose, volume: numberOrNull(quote.volume?.[i]) ?? 0 });
  }
  const dividends: Array<{ epoch: number; amount: number }> = [];
  for (const [epoch, item] of Object.entries(result.events?.dividends || {})) {
    const amount = numberOrNull((item as JsonRecord)?.amount);
    if (amount !== null) dividends.push({ epoch: Number(epoch), amount });
  }
  dividends.sort((a, b) => a.epoch - b.epoch);
  return {
    days,
    dividends,
    exchangeName: cleanText(result.meta?.exchangeName || result.meta?.fullExchangeName),
    regularMarketPrice: numberOrNull(result.meta?.regularMarketPrice),
    regularMarketTime: numberOrNull(result.meta?.regularMarketTime),
    firstTradeDate: numberOrNull(result.meta?.firstTradeDate),
  };
}

function pctChange(start: number | null, end: number | null): number | null {
  if (start === null || end === null || start === 0) return null;
  return round((end / start - 1) * 100, 2);
}

function annualized(start: number | null, end: number | null, years: number): number | null {
  if (start === null || end === null || start <= 0 || end <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

function anchor(days: ChartDay[], target: Date): ChartDay | null {
  let found: ChartDay | null = null;
  for (const day of days) {
    if (new Date(`${day.date}T00:00:00Z`) <= target) found = day;
    else break;
  }
  return found;
}

/** Unix start of the Yahoo request window: 0 for max, otherwise N years back (Yahoo ignores `range` next to period1/period2). */
export function historyPeriodStart(historyRange: string, now = Date.now()): number {
  const years = /^([1-9]\d*)y$/i.exec(String(historyRange ?? '').trim());
  return years ? Math.max(0, Math.floor(now / 1000 - Number(years[1]) * 365.25 * 86_400)) : 0;
}

export function priceReturns(days: ChartDay[], now = new Date()): PriceReturns {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered[ordered.length - 1];
  if (!last) return { ...EMPTY_PRICE_RETURNS };
  const date = new Date(`${last.date}T00:00:00Z`);
  const target = (years: number) => new Date(date.getTime() - years * 365.25 * 86_400_000);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const quarterStart = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, date.getUTCDate()));
  const start = (d: ChartDay | null) => d?.adjClose ?? null;
  const end = last.adjClose;
  void now;
  return {
    asOfDate: last.date,
    mo1: pctChange(start(anchor(ordered, monthStart)), end),
    qtd: pctChange(start(anchor(ordered, new Date(quarterStart.getTime() - 86_400_000))), end),
    ytd: pctChange(start(anchor(ordered, yearStart)), end),
    yr1: pctChange(start(anchor(ordered, target(1))), end),
    cagr3y: annualized(start(anchor(ordered, target(3))), end, 3),
    cagr5y: annualized(start(anchor(ordered, target(5))), end, 5),
    cagr10y: annualized(start(anchor(ordered, target(10))), end, 10),
    siAnn: ordered.length > 1 && date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime() >= 365 * 86_400_000 ? annualized(ordered[0].adjClose, end, Math.max(1 / 365, (date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime()) / (365.25 * 86_400_000))) : null,
  };
}

/**
 * Payment cadence from the ex-date gaps of the most recent distributions. The
 * median gap (not the mean) keeps a year-end special distribution from turning
 * a quarterly payer into "Irregular".
 */
export function inferDistributionFrequency(dividends: Array<{ epoch: number; amount: number }>): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  if (dividends.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const recent = [...dividends].sort((a, b) => a.epoch - b.epoch).slice(-9);
  const gaps = recent.slice(1).map((item, index) => (item.epoch - recent[index].epoch) / 86_400).filter((gap) => gap > 0).sort((a, b) => a - b);
  if (!gaps.length) return { frequency: 'Unknown', paymentsPerYear: null };
  const median = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  if (median <= 45) return { frequency: 'Monthly', paymentsPerYear: 12 };
  if (median <= 135) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (median <= 270) return { frequency: 'Semi-Annual', paymentsPerYear: 2 };
  if (median <= 500) return { frequency: 'Annual', paymentsPerYear: 1 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

/** Sortable coded label written into index.json (mirrors the client-side formatter). */
export function frequencyCodeLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
  if (!normalized || normalized === '-' || normalized === '—') return '00 - None';
  if (normalized === 'monthly') return '01 - Monthly';
  if (normalized === 'quarterly') return '04 - Quarterly';
  if (normalized === 'semi-annual' || normalized === 'semi-annually' || normalized === 'semiannual') return '06 - Semi-annually';
  if (normalized === 'annual' || normalized === 'annually') return '12 - Annually';
  if (normalized === 'none') return '00 - None';
  if (normalized === 'unknown') return '00 - Unknown';
  if (normalized === 'irregular') return '99 - Irregular';
  return raw;
}

function lastCompletedQuarterEnd(now = new Date()): string {
  const month = now.getUTCMonth();
  const quarterEndMonth = Math.floor(month / 3) * 3 - 1;
  const year = quarterEndMonth < 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const normalizedMonth = (quarterEndMonth + 12) % 12;
  const day = new Date(Date.UTC(year, normalizedMonth + 1, 0));
  return day.toISOString().slice(0, 10);
}

export const YIELD_BASIS_CODES = ['official-trailing-12m', 'official-distribution-rate', 'official-other', 'computed-trailing-12m', 'indicated'] as const;
export type YieldBasis = typeof YIELD_BASIS_CODES[number];

/** Known code or null, so a stored value can never smuggle in free text. */
export function knownYieldBasis(value: unknown): YieldBasis | null {
  return (YIELD_BASIS_CODES as readonly string[]).includes(String(value)) ? value as YieldBasis : null;
}

/**
 * Code for the yield a row carries; null exactly when the yield is null. A stored code wins, then the legacy
 * free-text kind (Schwab publishes "Distribution Yield (TTM)": trailing 12 months), then official-other for a
 * published yield of unknown origin, indicated otherwise.
 */
export function yieldBasisFor(dividendYield: number | null, stored: unknown, kind: unknown = null): YieldBasis | null {
  if (dividendYield === null) return null;
  const code = knownYieldBasis(stored);
  if (code) return code;
  const text = String(kind ?? '');
  if (text.startsWith('Distribution Yield (TTM) published')) return 'official-trailing-12m';
  if (text.startsWith('indicated')) return 'indicated';
  return 'official-other';
}

const DERIVED_RETURNS_BASIS = 'adjusted market-price closes (Yahoo chart API), not official Schwab NAV returns';
const OFFICIAL_RETURNS_BASIS = 'official Schwab product-page NAV total returns (month-end) where published; Yahoo adjusted market-price closes for missing values';

export function deriveMetrics(effective: PriceReturns, fund: CatalogFund, dividends: Distribution[], frequency: { paymentsPerYear: number | null }, price: number | null, official: boolean): JsonRecord {
  const latest = dividends[dividends.length - 1];
  const published = fund.dividendYield !== null;
  const indicated = fund.dividendYield ?? (latest && frequency.paymentsPerYear && price ? round((latest.amount * frequency.paymentsPerYear / price) * 100, 2) : null);
  return {
    ytd: effective.ytd,
    tr1y: effective.yr1,
    tr3y: annualizedToTotal(effective.cagr3y, 3),
    tr5y: annualizedToTotal(effective.cagr5y, 5),
    tr10y: annualizedToTotal(effective.cagr10y, 10),
    cagr3y: effective.cagr3y,
    cagr5y: effective.cagr5y,
    cagr10y: effective.cagr10y,
    siAnn: effective.siAnn,
    dividendYield: indicated,
    dividendYieldText: indicated === null ? '—' : `${indicated.toFixed(2)}%`,
    dividendYieldBasis: yieldBasisFor(indicated, published ? (fund.dividendYieldBasis ?? 'official-other') : 'indicated'),
    secYield: fund.secYield,
    secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
    returnsBasis: official ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
    performanceAsOf: performanceAsOf(effective.asOfDate),
  };
}

/**
 * ISO date the returns are as of: the official product-page performance table
 * date, or the last Yahoo close date when the returns are derived. Never the
 * NAV date. null only when no date is known.
 */
export function performanceAsOf(date: string | null | undefined): string | null {
  const iso = toIsoDate(date || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing.
export const ADJ_CLOSE_NOISE = 1e-4;

export function historyRows(days: ChartDay[], published: JsonRecord[] = []): JsonRecord[] {
  // Yahoo recomputes the split/dividend-adjusted close on every request; storing
  // the raw float lets the last digit or two jitter between otherwise identical
  // requests, making every history row (and the fund) look "updated" on every
  // single run. Rounding to 2 decimals is well past any meaningful price
  // precision and absorbs that jitter.
  const publishedAdj = new Map(published.map((row) => [toIsoDate(row.Date), row['Adj Close']]));
  return days.map((day) => {
    const prior = publishedAdj.get(day.date);
    const priorAdj = numberOrNull(prior);
    let adjClose = String(round(day.adjClose, 2));
    if (priorAdj !== null && adjClose !== String(prior) && Math.abs(day.adjClose - priorAdj) <= 0.005 + ADJ_CLOSE_NOISE) adjClose = String(prior);
    return { Date: formatDate(day.date), Close: String(day.close), 'Adj Close': adjClose, Volume: String(day.volume) };
  });
}

function distributionRows(dividends: Distribution[]): string[][] {
  return dividends.map((item) => [formatUsDate(item.epoch), String(round(item.amount, 6))]);
}

export function mergeOfficialReturns(derived: PriceReturns, official: OfficialReturnRow | null): PriceReturns {
  if (!official) return derived;
  return {
    ...derived,
    asOfDate: official.asOfDate || derived.asOfDate,
    mo1: official.mo1 ?? derived.mo1,
    qtd: derived.qtd, // the product page publishes 3-month, not quarter-to-date
    ytd: official.ytd ?? derived.ytd,
    yr1: official.yr1 ?? derived.yr1,
    cagr3y: official.cagr3y ?? derived.cagr3y,
    cagr5y: official.cagr5y ?? derived.cagr5y,
    cagr10y: official.cagr10y ?? derived.cagr10y,
    siAnn: official.siAnn ?? derived.siAnn,
  };
}

function returnRowJson(row: OfficialReturnRow | null): JsonRecord | null {
  if (!row) return null;
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  return {
    asOfDate: row.asOfDate ? formatDate(row.asOfDate) : '—',
    mo1: row.mo1, mo1Text: text(row.mo1),
    mo3: row.mo3, mo3Text: text(row.mo3),
    ytd: row.ytd, ytdText: text(row.ytd),
    yr1: row.yr1, yr1Text: text(row.yr1),
    yr3: row.cagr3y, yr3Text: text(row.cagr3y),
    yr5: row.cagr5y, yr5Text: text(row.cagr5y),
    yr10: row.cagr10y, yr10Text: text(row.cagr10y),
    sinceInception: row.siAnn, sinceInceptionText: text(row.siAnn),
  };
}

// ---------------------------------------------------------------------------
// Previous feed access + writers
// ---------------------------------------------------------------------------

function parsePreviousFund(ticker: string, row: JsonRecord): CatalogFund {
  const metrics = row.metrics || {};
  const monthEnd = row.returns?.monthEnd || {};
  return {
    ticker,
    name: String(row.name || ticker),
    category: String(row.category || 'ETF'),
    categoryPath: String(row.category || 'ETF'),
    inception: toIsoDate(row.inceptionDate) || null,
    exchange: String(row.exchange || ''),
    cusip: String(row.cusip || ''),
    isin: String(row.isin || ''),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    grossTer: numberOrNull(row.terGrossValue),
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: numberOrNull(metrics.dividendYield),
    dividendYieldBasis: yieldBasisFor(numberOrNull(metrics.dividendYield), metrics.dividendYieldBasis, null),
    secYield: numberOrNull(metrics.secYield),
    asOfDate: null,
    returns: { ytd: numberOrNull(monthEnd.ytd), yr1: numberOrNull(monthEnd.yr1), yr3: numberOrNull(monthEnd.yr3), yr5: numberOrNull(monthEnd.yr5), yr10: numberOrNull(monthEnd.yr10), sinceInception: numberOrNull(monthEnd.sinceInception) },
    fundPage: String(row.fundPage || `${SCHWAB_SITE}/products/${ticker.toLowerCase()}`),
    source: 'previous index',
  };
}

async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  try {
    const data = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    const map = new Map<string, JsonRecord>();
    for (const row of Array.isArray(data.funds) ? data.funds : []) if (row?.ticker) map.set(String(row.ticker), row);
    return map;
  } catch {
    return new Map();
  }
}

async function readPreviousMeta(ticker: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8')) as JsonRecord;
  } catch {
    return null;
  }
}

/**
 * Index row rebuilt from a published meta.json (same shapes as the row
 * processFund returns). inceptionDate is not stored in meta.json, so it comes
 * from the caller (previous row or first history date).
 */
export function rowFromMeta(meta: JsonRecord, inceptionDate: string | null = null): JsonRecord {
  const ticker = String(meta.ticker);
  const monthEnd: JsonRecord = meta.returns?.monthEnd || {};
  const rows: string[][] = Array.isArray(meta.distributions?.rows) ? meta.distributions.rows : [];
  const latest = rows[rows.length - 1];
  const frequency = meta.distributions?.frequency || '—';
  const pct = (value: unknown) => numberOrNull(value);
  const dividendYield = pct(meta.yields?.dividendYield);
  const secYield = pct(meta.yields?.secYield);
  const performance = meta.returns?.performanceAsOf ?? performanceAsOf(monthEnd.asOfDate === '—' ? '' : monthEnd.asOfDate);
  const metrics: JsonRecord = {
    ytd: pct(monthEnd.ytd),
    tr1y: pct(monthEnd.yr1),
    tr3y: annualizedToTotal(pct(monthEnd.yr3), 3),
    tr5y: annualizedToTotal(pct(monthEnd.yr5), 5),
    tr10y: annualizedToTotal(pct(monthEnd.yr10), 10),
    cagr3y: pct(monthEnd.yr3),
    cagr5y: pct(monthEnd.yr5),
    cagr10y: pct(monthEnd.yr10),
    siAnn: pct(monthEnd.sinceInception),
    dividendYield,
    dividendYieldText: dividendYield === null ? '—' : `${dividendYield.toFixed(2)}%`,
    dividendYieldBasis: yieldBasisFor(dividendYield, meta.yields?.dividendYieldBasis, meta.yields?.dividendYieldKind),
    secYield,
    secYieldText: secYield === null ? '—' : `${secYield.toFixed(2)}%`,
    returnsBasis: meta.returns?.derivedFrom || DERIVED_RETURNS_BASIS,
    performanceAsOf: performance || null,
  };
  return {
    ticker,
    name: meta.name,
    category: meta.category,
    fundPage: meta.source?.fundPage,
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: meta.identifiers?.cusip || null,
    isin: meta.identifiers?.isin || null,
    ter: meta.expenseRatio?.display ?? '—',
    terValue: pct(meta.expenseRatio?.value),
    terGross: pct(meta.expenseRatio?.gross) === null ? '—' : `${pct(meta.expenseRatio?.gross)}%`,
    terGrossValue: pct(meta.expenseRatio?.gross),
    nav: meta.nav?.display ?? '—',
    navValue: pct(meta.nav?.value),
    aum: meta.aum?.display ?? '—',
    aumValue: pct(meta.aum?.value),
    asOfDate: meta.nav?.asOfDate || '—',
    inceptionDate: inceptionDate || '—',
    exchange: meta.identifiers?.exchange || '',
    closePrice: meta.marketPrice?.display ?? '—',
    closePriceValue: pct(meta.marketPrice?.value),
    premiumDiscount: meta.premiumDiscount?.display ?? '—',
    premiumDiscountValue: pct(meta.premiumDiscount?.value),
    frequencyCode: meta.distributions?.frequencyCode || frequencyCodeLabel(frequency),
    distributions: { frequency, exDate: latest?.[0] || '—', dividend: latest?.[1] !== undefined ? String(latest[1]) : '—' },
    returns: meta.returns,
    metrics,
    holdings: pct(meta.holdings?.totalRows) ?? 0,
    history: pct(meta.history?.totalRows) ?? 0,
  };
}

/** Every fund with a published meta.json that the index does not list yet (rows rebuilt offline). */
export async function readMissingRows(listed: Set<string>): Promise<Map<string, JsonRecord>> {
  const rows = new Map<string, JsonRecord>();
  let names: string[] = [];
  try { names = await readdir(new URL('funds/', API_ROOT)); } catch { return rows; }
  for (const ticker of names.sort()) {
    if (listed.has(ticker)) continue;
    const meta = await readPreviousMeta(ticker);
    if (!meta?.ticker) continue;
    let inception: string | null = null;
    const first = Array.isArray(meta.history?.pages) ? meta.history.pages[0] : null;
    if (first) {
      try {
        const page = JSON.parse(await readFile(new URL(`funds/${ticker}/${first}`, API_ROOT), 'utf8')) as JsonRecord;
        inception = page.rows?.[0]?.Date || null;
      } catch { /* no history page */ }
    }
    rows.set(ticker, rowFromMeta(meta, inception));
  }
  return rows;
}

export function indexDocument(funds: JsonRecord[]): JsonRecord {
  const sorted = [...funds].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  return {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'Schwab Asset Management (Charles Schwab Investment Management, Inc.), U.S.-listed ETFs',
      market: 'us',
      site: SCHWAB_SITE,
      catalog: SCHWAB_CATALOG_URL,
      catalogFallback: proxyUrl(SCHWAB_CATALOG_URL),
      holdings: 'schwabassetmanagement.com full holdings CSV export per fund (SEC EDGAR Form N-PORT-P fallback)',
      distributions: 'schwabassetmanagement.com distribution history CSV export per fund (Yahoo dividend events fallback)',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts: { funds: sorted.length, holdings: sorted.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: sorted.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) },
    funds: sorted,
  };
}

async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const meta = await readPreviousMeta(ticker);
  const pages = meta?.[kind]?.pages;
  if (!Array.isArray(pages)) return [];
  const rows: JsonRecord[] = [];
  for (const page of pages) {
    try {
      const pagePath = String(page).includes('/') ? String(page) : `${kind}/${page}`;
      const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
      if (Array.isArray(data.rows)) rows.push(...data.rows);
    } catch {
      // Keep the rows already recovered from earlier pages.
    }
  }
  return rows;
}

async function readPreviousHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[] | null> {
  const meta = await readPreviousMeta(ticker);
  const first = Array.isArray(meta?.[kind]?.pages) ? meta[kind].pages[0] : null;
  if (!first) return null;
  try {
    const pagePath = String(first).includes('/') ? String(first) : `${kind}/${first}`;
    const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(data.headers) ? data.headers : null;
  } catch {
    return null;
  }
}

// Comparing raw text would treat a run that only refreshed generatedAt (with
// every fund's actual data unchanged) as a real change and rewrite the file
// every time. Compare with both timestamps stripped instead.
export function samePublishedContent(previous: string, value: unknown): boolean {
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { generatedAt, savedAt, ...content } = item as Record<string, unknown>;
    return content;
  };
  try {
    return JSON.stringify(withoutRunTimestamp(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamp(value));
  } catch { return false; }
}

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const previous = await readFile(file, 'utf8');
    if (previous === text || samePublishedContent(previous, value)) return false;
  } catch {
    // New file.
  }
  await mkdir(new URL('.', file), { recursive: true });
  const tmp = new URL(`${file.pathname.split('/').pop()}.${process.pid}.tmp`, file);
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
  return true;
}

async function writePages(fundDir: URL, ticker: string, kind: 'holdings' | 'history', headers: string[], rows: JsonRecord[], pageSize: number, asOfDate: string | null, source: string): Promise<JsonRecord> {
  const dir = new URL(`${kind}/`, fundDir);
  await mkdir(dir, { recursive: true });
  const pageCount = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  const kept = new Set<string>();
  for (let page = 0; page < pageCount; page += 1) {
    const name = `${String(page + 1).padStart(3, '0')}.json`;
    kept.add(name);
    await writeIfChanged(new URL(name, dir), { ticker, page: page + 1, pageSize, totalRows: rows.length, headers, rows: rows.slice(page * pageSize, (page + 1) * pageSize) });
  }
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
}

/** Stale pages go only after the new meta.json is written, so a crash never leaves a manifest pointing at removed pages. */
async function removeStalePages(fundDir: URL, kind: 'holdings' | 'history', manifest: JsonRecord): Promise<void> {
  const dir = new URL(`${kind}/`, fundDir);
  const kept = new Set((manifest.pages as string[]).map((page) => page.split('/').pop()));
  try {
    for (const name of await readdir(dir)) if (name.endsWith('.json') && !kept.has(name)) await rm(new URL(name, dir), { force: true });
  } catch {
    // Directory may not exist on a zero-row first run.
  }
}

function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  return reasons;
}

export function postFetchFilterReasons(fund: CatalogFund, metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(numberOrNull(metrics.dividendYield), config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  if (!rangeMatches(numberOrNull(metrics.secYield), config.secYield)) reasons.push('SEC_YIELD');
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (!rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (!rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Per-fund pipeline
// ---------------------------------------------------------------------------

/**
 * A product page must carry the Fund Profile table with a numeric NAV or Total Net Assets row, not a bot wall or a page with
 * a stray marker word. Whether it loaded fully (quote, profile and both performance tables) is
 * `parseProductPage(...).loadedFully`; a partial page is handled per section by `retainPublishedSections`.
 */
export function isProductPage(text: string): boolean {
  const lines = toTextLines(htmlToText(stripProxyPreamble(text)));
  return labelNumber(lookupLabel(lines, 'NAV')) !== null || labelNumber(lookupLabel(lines, 'Total Net Assets')) !== null;
}

const OFFICIAL_PREMIUM_SOURCE = 'official product page Quote Details';
const OFFICIAL_AUM_SOURCE = 'official product page Total Net Assets';
export const NO_DATA_BASIS = 'no data published for this fund yet; the next successful update fills it';

/** A published returns block (returnRowJson / quarterEnd shape) back as an official row; null when it carries no figure. */
function officialRowFromPublished(block: any): OfficialReturnRow | null {
  if (!block || typeof block !== 'object') return null;
  const asOf = toIsoDate(block.asOfDate);
  const row: OfficialReturnRow = {
    asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : '',
    mo1: numberOrNull(block.mo1), mo3: numberOrNull(block.mo3), ytd: numberOrNull(block.ytd), yr1: numberOrNull(block.yr1),
    cagr3y: numberOrNull(block.yr3), cagr5y: numberOrNull(block.yr5), cagr10y: numberOrNull(block.yr10), siAnn: numberOrNull(block.sinceInception),
  };
  return [row.mo1, row.mo3, row.ytd, row.yr1, row.cagr3y, row.cagr5y, row.cagr10y, row.siAnn].some((value) => value !== null) ? row : null;
}

/**
 * A product page that came back partial (the rendering proxy dropped sections: see `loadedFully`) says nothing about the
 * sections it lacks. Every section that was published as official before and is missing from such a page counts as a
 * FAILED read: its previous official block is restored into `summary`/`fund` as one unit (values with their as-of dates,
 * basis and sources), so the normal build republishes it unchanged instead of flipping to Yahoo-derived values or null.
 * A page that loaded fully and lacks a field is an honest null and never gets here. Returns the names of the kept sections.
 */
function retainPublishedSections(summary: ProductPageSummary, fund: CatalogFund, previousMeta: JsonRecord | null): string[] {
  if (summary.loadedFully || !previousMeta) return [];
  const kept: string[] = [];
  const asIso = (value: unknown) => { const iso = toIsoDate(value); return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null; };
  const facts = previousMeta.fundFacts || {};
  if (!summary.sections.quote) {
    const premium = previousMeta.premiumDiscount;
    const officialPremium = String(premium?.source || '').startsWith(OFFICIAL_PREMIUM_SOURCE) && numberOrNull(premium.value) !== null;
    const midpoint = numberOrNull(facts.bidAskMidpoint);
    if (officialPremium || midpoint !== null) {
      if (officialPremium) {
        summary.premiumDiscount = numberOrNull(premium.value);
        summary.premiumDiscountAsOfDate = asIso(premium.asOfDate);
        fund.premiumDiscount = summary.premiumDiscount;
      }
      summary.bidAskMidpoint = midpoint;
      if (!summary.navHistoryCsvUrl && previousMeta.source?.navHistoryDownload) summary.navHistoryCsvUrl = String(previousMeta.source.navHistoryDownload);
      kept.push('quote details');
    }
  }
  if (!summary.sections.profile) {
    const aum = previousMeta.aum;
    const nav = previousMeta.nav;
    const officialAum = String(aum?.source || '').startsWith(OFFICIAL_AUM_SOURCE) && numberOrNull(aum.value) !== null;
    // meta.source.productPageAsOf is set only when the page itself carried the NAV as-of date: the published NAV came from the page
    const officialNav = Boolean(previousMeta.source?.productPageAsOf) && numberOrNull(nav?.value) !== null;
    if (officialAum || officialNav) {
      if (officialNav) {
        summary.nav = numberOrNull(nav.value);
        summary.navAsOfDate = asIso(nav.asOfDate);
        fund.nav = summary.nav;
        if (summary.navAsOfDate) fund.asOfDate = summary.navAsOfDate;
      }
      if (officialAum) {
        summary.totalNetAssets = numberOrNull(aum.value);
        summary.totalNetAssetsAsOfDate = asIso(aum.asOfDate);
        fund.netAssets = summary.totalNetAssets;
      }
      summary.sharesOutstanding = numberOrNull(facts.sharesOutstanding);
      summary.portfolioTurnover = numberOrNull(facts.portfolioTurnover);
      summary.totalHoldings = numberOrNull(facts.publishedTotalHoldings);
      const ids = previousMeta.identifiers || {};
      if (ids.morningstarCategory) { summary.morningstarCategory = String(ids.morningstarCategory); if (previousMeta.categoryPath) fund.categoryPath = String(previousMeta.categoryPath); }
      if (!fund.cusip && ids.cusip) fund.cusip = String(ids.cusip);
      if (!fund.exchange && ids.exchange) fund.exchange = String(ids.exchange);
      if (!fund.benchmark && ids.indexTicker) fund.benchmark = String(ids.indexTicker);
      kept.push('fund profile');
    }
  }
  if (!summary.sections.yields) {
    const yields = previousMeta.yields || {};
    const asOfOf = (kind: unknown) => asIso(/ as of (.+)$/.exec(String(kind || ''))?.[1]);
    const keepSec = String(yields.secYieldKind || '').startsWith('SEC Yield (30 Day) published') && numberOrNull(yields.secYield) !== null;
    const keepDist = String(yields.dividendYieldKind || '').startsWith('Distribution Yield (TTM) published') && numberOrNull(yields.distributionRate) !== null;
    if (keepSec) { summary.secYield = numberOrNull(yields.secYield); summary.secYieldAsOfDate = asOfOf(yields.secYieldKind); fund.secYield = summary.secYield; }
    if (keepDist) { summary.distributionYield = numberOrNull(yields.distributionRate); summary.distributionYieldAsOfDate = asOfOf(yields.dividendYieldKind); fund.dividendYield = summary.distributionYield; fund.dividendYieldBasis = 'official-trailing-12m'; }
    if (keepSec || keepDist) kept.push('yields');
  }
  const previousReturns = previousMeta.returns || {};
  if (!summary.sections.recent) {
    const nav = String(previousReturns.derivedFrom || '').startsWith('official') ? officialRowFromPublished(previousReturns.monthEnd) : null;
    const marketPrice = officialRowFromPublished(previousMeta.officialMarketPriceReturns?.monthEnd);
    if (nav || marketPrice) { summary.officialReturns.monthEnd = { nav, marketPrice }; kept.push('month-end returns'); }
  }
  if (!summary.sections.quarter) {
    const nav = officialRowFromPublished(previousReturns.quarterEnd);
    const marketPrice = officialRowFromPublished(previousMeta.officialMarketPriceReturns?.quarterEnd);
    if (nav || marketPrice) { summary.officialReturns.quarterEnd = { nav, marketPrice }; kept.push('quarter-end returns'); }
  }
  return kept;
}

/** Index row for a catalog fund that has no published data yet: no meta.json, so dataFile is null and every metric is null. */
export function placeholderRow(fund: Pick<CatalogFund, 'ticker' | 'name' | 'category' | 'fundPage' | 'cusip' | 'isin' | 'exchange' | 'ter' | 'inception'> & Partial<Pick<CatalogFund, 'grossTer'>>): JsonRecord {
  const grossTer = fund.grossTer ?? null;
  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: null,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    terGross: grossTer === null ? '—' : `${grossTer}%`,
    terGrossValue: grossTer,
    nav: '—', navValue: null, aum: '—', aumValue: null,
    asOfDate: '—', inceptionDate: fund.inception ? formatDate(fund.inception) : '—', exchange: fund.exchange || '',
    closePrice: '—', closePriceValue: null, premiumDiscount: '—', premiumDiscountValue: null,
    frequencyCode: frequencyCodeLabel('None'),
    distributions: { frequency: '—', exDate: '—', dividend: '—' },
    returns: {},
    metrics: {
      ytd: null, tr1y: null, tr3y: null, tr5y: null, tr10y: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null,
      dividendYield: null, dividendYieldText: '—', dividendYieldBasis: null, secYield: null, secYieldText: '—',
      returnsBasis: NO_DATA_BASIS, performanceAsOf: null,
    },
    holdings: 0,
    history: 0,
  };
}

const PROVIDER_LABEL = 'Schwab Asset Management product finder + official product page + per-fund holdings/distribution CSV exports + SEC EDGAR Form N-PORT-P fallback + Yahoo Finance public chart API';

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  const previousMeta = await readPreviousMeta(fund.ticker);
  // The gross expense ratio comes from the product finder only: a fund restored from the published index (finder failed) keeps its published one.
  if (fund.source === 'previous index' && fund.grossTer === null) fund.grossTer = numberOrNull(previousMeta?.expenseRatio?.gross);

  // 1. Official product page ---------------------------------------------------
  let summary: ProductPageSummary | null = null;
  let productVia: 'direct' | 'proxy' | null = null;
  if (!config.skipSchwab && fund.fundPage) {
    try {
      const page = await fetchIssuerText(fund.fundPage, `[product ] ${fund.ticker}`, config, isProductPage, undefined, { cache: false });
      productVia = page.via;
      summary = parseProductPage(page.text, fund.ticker);
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`${fund.ticker}-product-page.${page.via === 'proxy' ? 'md' : 'html'}`, raw), page.text, 'utf8');
      }
      if (summary.name) fund.name = summary.name;
      if (summary.cusip) fund.cusip = summary.cusip;
      if (summary.exchange) fund.exchange = summary.exchange;
      if (summary.indexName) fund.benchmark = summary.indexName;
      if (summary.inception) fund.inception = summary.inception;
      if (summary.totalExpenseRatio !== null) fund.ter = summary.totalExpenseRatio;
      if (summary.navAsOfDate) fund.asOfDate = summary.navAsOfDate;
      // A section that loaded and lacks a value publishes null: it is never refilled from the published index.
      // A missing section is handled by retainPublishedSections below.
      if (summary.sections.profile) { fund.nav = summary.nav; fund.netAssets = summary.totalNetAssets; }
      else {
        if (summary.nav !== null) fund.nav = summary.nav;
        if (summary.totalNetAssets !== null) fund.netAssets = summary.totalNetAssets;
      }
      if (summary.sections.quote) fund.premiumDiscount = summary.premiumDiscount;
      else if (summary.premiumDiscount !== null) fund.premiumDiscount = summary.premiumDiscount;
      if (summary.sections.yields) { fund.secYield = summary.secYield; fund.dividendYield = summary.distributionYield; fund.dividendYieldBasis = summary.distributionYield === null ? null : 'official-trailing-12m'; }
      else {
        if (summary.secYield !== null) fund.secYield = summary.secYield;
        if (summary.distributionYield !== null) { fund.dividendYield = summary.distributionYield; fund.dividendYieldBasis = 'official-trailing-12m'; }
      }
      if (summary.morningstarCategory) fund.categoryPath = `${fund.category} / ${summary.morningstarCategory}`;
    } catch (error) {
      outputNote(`[ ${'product'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // A partial page keeps what was published as official: one notice per fund naming the sections kept.
  const keptSections = summary ? retainPublishedSections(summary, fund, previousMeta) : [];
  if (keptSections.length) console.log(`[ ${'kept'.padEnd(9)}] ${fund.ticker}: product page came back partial, kept the published ${keptSections.join(', ')}`);
  if (!fund.isin && fund.cusip) fund.isin = isinFromCusip(fund.cusip);

  // 2. Holdings: issuer CSV -> N-PORT-P -> previous run ------------------------
  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders: string[] = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available from the issuer CSV export or a public SEC filing';
  let holdingsDownload: string | null = summary?.holdingsCsvUrl || null;
  let marketValueBasis: string | null = null;
  let nport: NportFiling | null = null;
  let holdingsFresh = false; // false while holdingsRows is the previous run's sheet
  if (!config.skipSchwab) {
    const candidates = summary?.holdingsCsvUrl ? [summary.holdingsCsvUrl] : holdingsCsvCandidates(fund.ticker, summary?.totalHoldingsAsOfDate || null);
    for (const url of candidates) {
      try {
        const csv = await fetchIssuerText(url, `[holdings] ${fund.ticker}`, config, isHoldingsCsv, 'text/csv,text/plain;q=0.9,*/*;q=0.8');
        const parsed = parseHoldingsCsv(csv.text, fund.netAssets);
        if (!parsed.rows.length) continue;
        holdingsRows = parsed.rows;
        holdingsHeaders = parsed.headers;
        holdingsFresh = true;
        holdingsAsOf = parsed.asOfDate;
        holdingsDownload = url;
        holdingsSource = `schwabassetmanagement.com full holdings CSV export (${url.split('/').pop()}${csv.via === 'proxy' ? ', via read-only rendering proxy' : ''})`;
        marketValueBasis = fund.netAssets !== null ? 'derived: Percent of Assets x Total Net Assets (the issuer CSV publishes weights, not values)' : 'not derivable: Total Net Assets unavailable in this run';
        break;
      } catch (error) {
        outputNote(`[ ${'holdings'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (!holdingsRows.length && config.edgarFallback) {
    try {
      // the fund's own newest filing, read only when strictly newer than the published holdings (shared nport-reader block)
      const ref = (await loadFundTickerTable(config)).get(fund.ticker);
      const read = ref
        ? await readNportHoldings({ ticker: fund.ticker, cik: ref.cik, seriesId: ref.seriesId }, { asOf: previousMeta?.holdings?.asOfDate, rows: numberOrNull(previousMeta?.holdings?.totalRows) ?? 0 }, (url, label) => fetchText(url, `[nport   ] ${label}`, config, secHeaders()), { cache: secState.reader })
        : { problem: `${fund.ticker}: not in the SEC fund ticker table` };
      if ('problem' in read) outputNote(`[ ${'nport'.padEnd(9)}] ${read.problem}`);
      else {
        const sheet = nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, await loadCompanyNames(config).catch(() => null)));
        holdingsRows = sheet.rows;
        holdingsHeaders = sheet.headers;
        holdingsFresh = true;
        holdingsAsOf = read.filing.repPdDate || null;
        nport = read.filing;
        holdingsDownload = read.url;
        holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate || 'n/a'})`;
        marketValueBasis = 'SEC Form N-PORT-P reported value (valUSD)';
      }
    } catch (error) {
      outputNote(`[ ${'nport'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!holdingsRows.length) {
    holdingsRows = await readPreviousSheet(fund.ticker, 'holdings');
    holdingsHeaders = (await readPreviousHeaders(fund.ticker, 'holdings')) || holdingsHeaders;
    holdingsAsOf = previousMeta?.holdings?.asOfDate || null;
    holdingsSource = previousMeta?.holdings?.source || holdingsSource;
    holdingsDownload = previousMeta?.source?.holdingsDownload || holdingsDownload;
    marketValueBasis = previousMeta?.holdings?.marketValueBasis || marketValueBasis;
  }

  // 3. Distributions: issuer CSV -> Yahoo dividends -> previous run -----------
  let dividends: Distribution[] = [];
  let distributionsSource = 'not available';
  let distributionsDownload: string | null = summary?.distributionsCsvUrl || distributionsCsvUrl(fund.ticker);
  if (!config.skipSchwab) {
    try {
      const csv = await fetchIssuerText(distributionsDownload, `[distrib ] ${fund.ticker}`, config, isDistributionsCsv, 'text/csv,text/plain;q=0.9,*/*;q=0.8', { cache: false });
      dividends = parseDistributionsCsv(csv.text);
      if (dividends.length) distributionsSource = `schwabassetmanagement.com distribution history CSV export (Total Distribution per share${csv.via === 'proxy' ? ', via read-only rendering proxy' : ''})`;
    } catch (error) {
      outputNote(`[ ${'distrib'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 4. Yahoo chart: history + dividend fallback --------------------------------
  let chart: ParsedChart | null = null;
  let days: ChartDay[] = [];
  let historySource = 'Yahoo Finance public chart API (adjusted close)';
  if (!config.skipYahoo) {
    try {
      const query = new URLSearchParams({ period1: String(historyPeriodStart(config.historyRange)), period2: String(Math.floor(Date.now() / 1000) + 86_400), interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
      const payload = await fetchJson(`${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}?${query.toString()}`, `[chart   ] ${fund.ticker}`, config, { 'User-Agent': 'Mozilla/5.0' });
      const fetched = parseChart(payload);
      // A HISTORY_RANGE window never shrinks the published history (and with it 3y, 5y, 10y and since inception)
      chart = historyPeriodStart(config.historyRange) > 0 ? mergeWindowedChart(fetched, await readPreviousSheet(fund.ticker, 'history'), Array.isArray(previousMeta?.distributions?.rows) ? previousMeta.distributions.rows : []) : fetched;
      if (!chart) throw new Error(`chart window does not join the published history (${config.historyRange})`);
      days = chart.days;
    } catch (error) {
      outputNote(`[ ${'chart'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!days.length) {
    const previousRows = await readPreviousSheet(fund.ticker, 'history');
    days = previousRows.map((row) => ({ date: toIsoDate(row.Date), close: numberOrNull(row.Close) || 0, adjClose: numberOrNull(row['Adj Close']) || numberOrNull(row.Close) || 0, volume: numberOrNull(row.Volume) || 0 })).filter((row) => row.date && row.close > 0);
    if (previousRows.length) historySource = previousMeta?.history?.source || 'previous run';
  }
  if (!dividends.length && chart?.dividends.length) {
    dividends = chart.dividends.map((item) => ({ epoch: item.epoch, amount: round(item.amount, 6) }));
    distributionsSource = 'Yahoo Finance chart dividend events (issuer distribution CSV unavailable)';
  }
  let distributionTable: string[][] = dividends.length ? distributionRows(dividends) : [];
  if (!distributionTable.length && Array.isArray(previousMeta?.distributions?.rows) && previousMeta.distributions.rows.length) {
    distributionTable = previousMeta.distributions.rows;
    distributionsSource = previousMeta.distributions.source || 'previous run';
    dividends = distributionTable.map((row) => ({ epoch: isoToEpoch(toIsoDate(row[0])) ?? 0, amount: numberOrNull(row[1]) ?? 0 })).filter((item) => item.epoch > 0 && item.amount > 0);
  }

  // 5. Returns + metrics --------------------------------------------------------
  const frequency = inferDistributionFrequency(dividends);
  const latest = dividends[dividends.length - 1] || null;
  const derived = priceReturns(days);
  const officialMonthly = summary?.officialReturns.monthEnd.nav || null;
  const officialQuarterly = summary?.officialReturns.quarterEnd.nav || null;
  const merged = mergeOfficialReturns(derived, officialMonthly);
  // the shared "younger than one year" rule: no horizon the fund is too young for, official or derived
  const effective = withoutYoungReturns(merged, fund.inception, merged.asOfDate, { yr1: 1, cagr3y: 3, cagr5y: 5, cagr10y: 10, siAnn: 1 });
  const marketPrice = chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : numberOrNull(previous.closePriceValue));
  // The published index fills a value only when the page section was not read at all (SKIP_SCHWAB); a section that loaded and
  // lacks a value publishes null. The market price is always the labelled Yahoo last price: the anonymous page publishes none.
  const profileRead = Boolean(summary?.sections.profile);
  const quoteRead = Boolean(summary?.sections.quote);
  const nav = profileRead ? summary!.nav : (fund.nav ?? numberOrNull(previous.navValue));
  const metrics = deriveMetrics(effective, fund, dividends, frequency, nav ?? marketPrice, Boolean(officialMonthly));
  const skipReasons = postFetchFilterReasons(fund, metrics, config);
  if (skipReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: skipReasons };
  }

  // A fund is either fully updated or fully kept: when a required source failed for a fund that is already
  // published, keep its previous complete state instead of mixing fresh columns with stale ones.
  // A fund with no published data has nothing to keep: it is not written at all and gets a catalog-only index row (dataFile null).
  // Fresh holdings that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone) never replace the published ones.
  const publishedWeights = holdingsFresh && previousMeta ? holdingsWeightCount((await readPreviousHeaders(fund.ticker, 'holdings')) || HOLDINGS_HEADERS, await readPreviousSheet(fund.ticker, 'holdings')) : null;
  const holdingsProblem = holdingsFresh ? holdingsGuard(holdingsHeaders, holdingsRows, numberOrNull(previousMeta?.holdings?.totalRows), HOLDINGS_GUARD_RELAX[fund.ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights) : null;
  if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${previousMeta ? 'kept the previous complete data' : 'no data published for this fund yet'}`);
  if ((!config.skipSchwab && !summary) || (!config.skipYahoo && !chart)) {
    throw new Error(`required source failed (${!summary && !config.skipSchwab ? 'product page' : 'Yahoo chart'}); ${previousMeta ? 'kept the previous complete data' : 'no data published for this fund yet'}`);
  }
  // A new fund that no source answered (for example SKIP_SCHWAB and SKIP_YAHOO with the catalog read from a catalog-only index row)
  // has nothing to publish: it fails and keeps its catalog-only row instead of an empty meta.json reported as updated (open-items etfs Q19).
  if (!previousMeta && !summary && !holdingsFresh && !chart) throw new Error('no source answered; no data published for this fund yet');

  // 6. Write sheets, meta.json and the index row --------------------------------
  await mkdir(fundDir, { recursive: true });
  const history = historyRows(days, chart?.days.length ? await readPreviousSheet(fund.ticker, 'history') : []);
  const historyAsOf = derived.asOfDate || previousMeta?.history?.asOf || null;
  const holdingManifest = await writePages(fundDir, fund.ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
  if (marketValueBasis) holdingManifest.marketValueBasis = marketValueBasis;
  if (summary?.totalHoldings !== null && summary?.totalHoldings !== undefined) holdingManifest.publishedTotalHoldings = summary.totalHoldings;
  const historyManifest = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), history, config.historyPageSize, historyAsOf, historySource);
  const distributionFrequency = dividends.length ? frequency.frequency : (previousMeta?.distributions?.frequency || '—');
  const premiumDiscount = fund.premiumDiscount ?? (nav && marketPrice ? round((marketPrice / nav - 1) * 100, 2) : quoteRead ? null : numberOrNull(previous.premiumDiscountValue));
  const netAssets = fund.netAssets ?? nport?.netAssets ?? (profileRead ? null : numberOrNull(previous.aumValue));
  const asOfDate = fund.asOfDate || toIsoDate(previous.asOfDate) || null;
  const asOfLabel = asOfDate ? formatDate(asOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : '—';
  const marketPriceAsOfLabel = chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : (days.length ? formatDate(days[days.length - 1].date) : asOfLabel);
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  const returns: JsonRecord = {
    derivedFrom: officialMonthly ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
    performanceAsOf: metrics.performanceAsOf,
    monthEnd: {
      asOfDate: effective.asOfDate ? formatDate(effective.asOfDate) : '—',
      mo1: effective.mo1, mo1Text: text(effective.mo1),
      mo3: officialMonthly?.mo3 ?? null, mo3Text: text(officialMonthly?.mo3 ?? null),
      qtd: effective.qtd, qtdText: text(effective.qtd),
      ytd: effective.ytd, ytdText: text(effective.ytd),
      yr1: effective.yr1, yr1Text: text(effective.yr1),
      yr3: effective.cagr3y, yr3Text: text(effective.cagr3y),
      yr5: effective.cagr5y, yr5Text: text(effective.cagr5y),
      yr10: effective.cagr10y, yr10Text: text(effective.cagr10y),
      sinceInception: effective.siAnn, sinceInceptionText: text(effective.siAnn),
    },
    quarterEnd: officialQuarterly ? {
      asOfDate: officialQuarterly.asOfDate ? formatDate(officialQuarterly.asOfDate) : formatDate(lastCompletedQuarterEnd()),
      ytd: null,
      yr1: officialQuarterly.yr1,
      yr3: officialQuarterly.cagr3y,
      yr5: officialQuarterly.cagr5y,
      yr10: officialQuarterly.cagr10y,
      sinceInception: officialQuarterly.siAnn,
    } : { asOfDate: formatDate(lastCompletedQuarterEnd()), ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
  };

  const meta: JsonRecord = {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    categoryPath: fund.categoryPath || fund.category,
    source: {
      fundPage: fund.fundPage,
      officialProductPage: fund.fundPage,
      productPageRendering: productVia ? (productVia === 'proxy' ? 'read-only rendering proxy (r.jina.ai) of the official product page' : 'official product page (direct)') : 'not fetched in this run',
      productPageAsOf: summary?.navAsOfDate ? formatDate(summary.navAsOfDate) : null,
      holdingsDownload,
      distributionsDownload,
      navHistoryDownload: summary?.navHistoryCsvUrl || null,
      pricesDownload: null,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}`,
      holdingsSource,
      historySource,
      distributionsSource,
      provider: PROVIDER_LABEL,
    },
    identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, isinBasis: fund.isin ? (fund.cusip && fund.isin === isinFromCusip(fund.cusip) ? 'derived from the published CUSIP (US prefix + check digit)' : 'previous run') : null, indexTicker: fund.benchmark || null, exchange: fund.exchange || null, morningstarCategory: summary?.morningstarCategory || null },
    expenseRatio: { display: fund.ter === null ? '—' : `${fund.ter}%`, value: fund.ter, gross: fund.grossTer, kind: 'Total Expense Ratio published on the official product page (net expense ratio in the product finder)' },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: summary?.navAsOfDate ? formatDate(summary.navAsOfDate) : asOfLabel },
    marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: marketPriceAsOfLabel, source: chart ? 'Yahoo Finance last regular-session price (the anonymous product page publishes no closing price)' : 'previous run' },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount, asOfDate: summary?.premiumDiscountAsOfDate ? formatDate(summary.premiumDiscountAsOfDate) : asOfLabel, source: fund.premiumDiscount !== null ? 'official product page Quote Details' : 'computed from Yahoo last price / product-page NAV' },
    aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: summary?.totalNetAssetsAsOfDate ? formatDate(summary.totalNetAssetsAsOfDate) : (nport?.repPdDate ? formatDate(nport.repPdDate) : asOfLabel), source: summary?.totalNetAssets !== null && summary?.totalNetAssets !== undefined ? 'official product page Total Net Assets' : nport ? `SEC Form N-PORT-P net assets (${nport.repPdDate || 'n/a'})` : 'previous run' },
    fundFacts: { sharesOutstanding: summary?.sharesOutstanding ?? null, portfolioTurnover: summary?.portfolioTurnover ?? null, publishedTotalHoldings: summary?.totalHoldings ?? null, bidAskMidpoint: summary?.bidAskMidpoint ?? null },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldBasis: metrics.dividendYieldBasis,
      dividendYieldKind: fund.dividendYield !== null ? `Distribution Yield (TTM) published on the official product page${summary?.distributionYieldAsOfDate ? ` as of ${formatDate(summary.distributionYieldAsOfDate)}` : ''}` : 'indicated (latest distribution x inferred payments per year / NAV)',
      distributionRate: summary?.distributionYield ?? null,
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind: fund.secYield !== null ? `SEC Yield (30 Day) published on the official product page${summary?.secYieldAsOfDate ? ` as of ${formatDate(summary.secYieldAsOfDate)}` : ''}` : 'not published on the official product page for this fund',
    },
    returns,
    officialMarketPriceReturns: summary ? { monthEnd: returnRowJson(summary.officialReturns.monthEnd.marketPrice), quarterEnd: returnRowJson(summary.officialReturns.quarterEnd.marketPrice) } : null,
    distributions: { frequency: distributionFrequency, frequencyCode: frequencyCodeLabel(distributionFrequency), paymentsPerYear: frequency.paymentsPerYear, source: distributionsSource, headers: ['Ex-Date', 'Amount'], rows: distributionTable },
    holdings: holdingManifest,
    history: historyManifest,
  };
  await writeIfChanged(new URL('meta.json', fundDir), meta);
  await removeStalePages(fundDir, 'holdings', holdingManifest);
  await removeStalePages(fundDir, 'history', historyManifest);

  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: `./funds/${fund.ticker}/meta.json`,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    terGross: fund.grossTer === null ? '—' : `${fund.grossTer}%`,
    terGrossValue: fund.grossTer,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: asOfLabel,
    inceptionDate: fund.inception ? formatDate(fund.inception) : chart?.firstTradeDate ? formatDate(new Date(chart.firstTradeDate * 1000).toISOString().slice(0, 10)) : (previous.inceptionDate || '—'),
    exchange: fund.exchange || chart?.exchangeName || previous.exchange || '',
    closePrice: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`,
    closePriceValue: marketPrice,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    frequencyCode: frequencyCodeLabel(distributionFrequency),
    distributions: { frequency: distributionFrequency, exDate: latest ? formatUsDate(latest.epoch) : (previous.distributions?.exDate || '—'), dividend: latest ? String(round(latest.amount, 6)) : (previous.distributions?.dividend || '—') },
    returns,
    metrics,
    holdings: holdingsRows.length,
    history: history.length,
  };
}

function historyHeaders(): string[] {
  return ['Date', 'Close', 'Adj Close', 'Volume'];
}

function configLines(config: UpdaterConfig): string[] {
  return [
    `MAX_FETCHES=${config.maxFetches || 'all'}`,
    `REQUEST_SLEEP=${config.requestSleep}s`,
    `CONCURRENCY=${config.concurrency}`,
    `AUM=${config.aum ? JSON.stringify(config.aum) : '—'}`,
    `TER=${config.ter ? JSON.stringify(config.ter) : '—'}`,
    `TICKERS=${config.tickers ? [...config.tickers].join(',') : 'all'}`,
    `EDGAR_FALLBACK=${config.edgarFallback}`,
    `HISTORY_RANGE=${config.historyRange}`,
  ];
}

const USAGE = `
Schwab ETF static data updater

Sources:
  catalog       Schwab Asset Management product finder, ETFs only (official
                page; read-only r.jina.ai rendering fallback when a
                non-browser request is refused)
  product page  official per-fund page: Fund Profile, yields, NAV and market
                price total returns, links to the CSV exports
  holdings      dated "Export All Holdings" CSV per fund (SEC EDGAR Form
                N-PORT-P for the exact series when the CSV is unavailable)
  distributions "Export Data" distribution history CSV per fund (Yahoo
                dividend events as the fallback)
  history       Yahoo Finance public chart API (adjusted market-price closes)

Configuration: scripts/update-data.config.json defaults < advanced JSON (workflow
only) < nonblank workflow inputs < environment variables below (all filters use
AND logic):
  MAX_FETCHES=0       all eligible funds; positive value is a resumable batch
  REQUEST_SLEEP=2     seconds between request starts (proxy requests >= 3.2s)
  CONCURRENCY=2       parallel fund workers; every request stays paced
  AUM=:\n  TER=:\n  DIVIDEND_YIELD=:\n  SEC_YIELD=:\n  TICKERS="SCHD SCHX"  optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max
  MAX_RETRIES=2       retries after the initial request (integer >= 1)
  STORE_RAW_DOWNLOADS=false
  EDGAR_FALLBACK=true
  SEC_UA=             SEC User-Agent override (declare a contact); blank uses the built-in default (daggerok ETF feed daggerok@gmail.com)
  VERBOSE=false
  USE_SYSTEM_CA=auto  TLS trust store: auto restarts once with --use-system-ca on an untrusted-certificate error | true | false
  SKIP_SCHWAB=off     use the previously published catalog/product data
  SKIP_YAHOO=off      keep previously published history when possible

Examples:
  TICKERS="SCHD SCHX SCHZ" ./scripts/update-data.ts
  AUM="large:" TER=":0.10" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
`;

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

// File defaults and explicit overrides: allowlisted scalar controls only, so
// GitHub Actions can resolve them without interpolating user input into bash.
// Precedence: config file < advanced JSON < nonblank inputs < environment.
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'TICKERS',
  'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'STORE_RAW_DOWNLOADS', 'MAX_RETRIES', 'HISTORY_RANGE',
  'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_SCHWAB', 'SEC_UA', 'VERBOSE', 'USE_SYSTEM_CA',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = env[key];
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v.trim() === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  const sleep = result.REQUEST_SLEEP;
  if (sleep && sleep.trim() && (!Number.isFinite(Number(sleep)) || Number(sleep) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['STORE_RAW_DOWNLOADS', 'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_SCHWAB', 'VERBOSE']) {
    if (result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key].trim())) throw new Error(`${key}: expected boolean`);
  }
  if (result.USE_SYSTEM_CA !== undefined) {
    const mode = result.USE_SYSTEM_CA.trim().toLowerCase();
    if (!['auto', 'true', 'false'].includes(mode)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA = mode;
  }
  const range = result.HISTORY_RANGE?.trim();
  if (range !== undefined && range !== '' && !/^(max|[1-9]\d*y)$/i.test(range)) throw new Error('HISTORY_RANGE: expected max or Ny (for example 5y)');
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  const file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8'));
  return resolveControls(file, {}, {}, env);
}

/** The workflow times out at 30 min: stop taking new funds after 25 and still write the index. */
export const SOFT_DEADLINE_MS = 25 * 60 * 1000;
export function softDeadlineReached(startedAt: number, now: number, limit = SOFT_DEADLINE_MS): boolean {
  return now - startedAt >= limit;
}

async function readCursorState(): Promise<{ cursor: string; scope: string } | null> {
  try {
    const state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord;
    return { cursor: String(state.cursor || ''), scope: String(state.scope ?? '') };
  } catch {
    return null;
  }
}

export async function main(): Promise<void> {
  const startedAt = Date.now();
  const controls = await runtimeControls();
  if (controls.VERBOSE !== undefined) process.env.VERBOSE = controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  const config = readConfig(controls);
  secUa = config.secUa;
  requestSleepSeconds = config.requestSleep;
  requestGates = new Array(Math.max(1, config.concurrency)).fill(0);
  proxyGateAt = 0;
  issuerDirectDenials = 0;
  resetSecState();
  outputPrintConfig('Schwab', config);

  const previous = await readPreviousIndex();
  // The index must list every fund that has a meta.json, even when an earlier run shrank it.
  for (const [ticker, row] of await readMissingRows(new Set(previous.keys()))) previous.set(ticker, row);
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/schwab/index.json';
  if (!config.skipSchwab) {
    try {
      const fetched = await fetchIssuerText(SCHWAB_CATALOG_URL, '[catalog ] product finder', config, (text) => /\/products\/[a-z0-9]{3,5}/i.test(text) && /Asset Class|Expense Ratio/i.test(text), undefined, { cache: false });
      const parsed = parseCatalogText(fetched.text);
      for (const fund of parsed) catalog.set(fund.ticker, fund);
      catalogSource = fetched.via === 'proxy' ? 'Schwab Asset Management product finder via read-only rendering proxy' : 'Schwab Asset Management product finder';
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`product-finder-${new Date().toISOString().slice(0, 10)}.${fetched.via === 'proxy' ? 'md' : 'html'}`, raw), fetched.text, 'utf8');
      }
    } catch (error) {
      console.warn(`[ ${'catalog'.padEnd(9)}] ${(error instanceof Error ? error.message : String(error)).replace(/^\[[^\]]*\]\s*/, '')} — keeping the published feed`);
    }
  }
  // The live catalog (null when only the published feed is known): a catalog-only row it no longer lists is dropped, never retried.
  const live = catalog.size ? Array.from(catalog.keys()) : null;
  if (!catalog.size) for (const [ticker, row] of previous) catalog.set(ticker, parsePreviousFund(ticker, row));
  if (live) for (const [ticker, row] of previous) if (!catalog.has(ticker) && row.dataFile) catalog.set(ticker, parsePreviousFund(ticker, row));

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where www.schwabassetmanagement.com is reachable or seed api/schwab/index.json first.');
  console.log(`[ ${'catalog'.padEnd(9)}] ${universe.length} Schwab ETFs (${catalogSource})`);

  // Q27: a TICKERS entry outside the live catalog and the published funds stops the run before any fund request
  assertKnownTickers(config.tickers ? Array.from(config.tickers) : null, knownTickers(live, Array.from(previous.values())), 'the Schwab catalog or published feed');

  // Bounded batches resume from a cursor scoped to the filter set. A TICKERS run never reads or writes the cursor.
  const scope = JSON.stringify({ aum: config.aum ?? null, ter: config.ter ?? null, dy: config.dividendYield ?? null, sy: config.secYield ?? null, p: config.performance, t: config.totalReturn });
  const cursorState = config.tickers ? null : await readCursorState();
  const cursor = config.maxFetches > 0 && cursorState && cursorState.scope === scope ? cursorState.cursor : '';
  const index = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered = index >= 0 ? universe.slice(index + 1).concat(universe.slice(0, index + 1)) : universe;
  // Catalog-level filters (TICKERS, TER) are applied up front so skipped funds never consume the MAX_FETCHES budget.
  const queue = withoutClosedFunds(ordered.filter((fund) => catalogFilterReasons(fund, config).length === 0), (fund) => fund.ticker, CLOSED_FUNDS);
  const orderOf = new Map(ordered.map((fund, position) => [fund.ticker, position]));
  const totalAttempts = config.maxFetches > 0 ? Math.min(config.maxFetches, queue.length) : queue.length;
  const results: JsonRecord[] = [];
  let counted = 0;
  let failures = 0;
  let lastPosition = -1;
  const runStartedAt = Date.now();
  let deadlineHit = false;
  outputPrintFilter(queue.length, universe.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, totalAttempts);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (config.maxFetches > 0 && counted >= config.maxFetches) return;
      if (softDeadlineReached(runStartedAt, Date.now())) { deadlineHit = true; return; }
      const fund = queue.shift();
      if (!fund) return;
      const before = await output.before(fund.ticker);
      try {
        const row = await processFund(fund, config, previous.get(fund.ticker) || {});
        if (row.__skipped) {
          await output.result(fund.ticker, before, 'skipped', (row.__skipReasons || ['not eligible']).join(', '));
        } else {
          counted += 1;
          lastPosition = Math.max(lastPosition, orderOf.get(fund.ticker) ?? -1);
          results.push(row);
          await output.result(fund.ticker, before);
        }
      } catch (error) {
        counted += 1;
        lastPosition = Math.max(lastPosition, orderOf.get(fund.ticker) ?? -1);
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        await output.result(fund.ticker, before, 'failed', message);
      }
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));
  if (deadlineHit) console.warn(`[ ${'deadline'.padEnd(9)}] soft deadline reached after ${Math.round((Date.now() - runStartedAt) / 60000)} min; remaining funds keep their published data`);
  const lastTicker: string | null = lastPosition >= 0 ? ordered[lastPosition].ticker : (cursor || null);

  // Filtered, bounded, skipped and failed funds keep their published row: the index never shrinks.
  const byTicker = new Map<string, JsonRecord>(withoutStalePlaceholders(Array.from(previous.values()), live).map((row) => [String(row.ticker), row] as [string, JsonRecord]));
  for (const row of results) byTicker.set(String(row.ticker), row);
  // A catalog fund without published data (new, or its first read failed) is still listed: no meta.json, so dataFile is null.
  for (const fund of universe) if (!byTicker.has(fund.ticker)) byTicker.set(fund.ticker, placeholderRow(fund));
  const funds = markClosedFunds([...byTicker.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))), CLOSED_FUNDS);
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, indexDocument(funds));
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(Array.from(previous.values()), funds));
  for (const line of newFunds) console.log(line);
  if (newFunds.length && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFunds.join('\n')}\n`, 'utf8');
  if (!config.tickers) await writeIfChanged(STATE_FILE, { cursor: config.maxFetches > 0 ? lastTicker : null, scope: config.maxFetches > 0 ? scope : null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  if (failures > 0 && results.length === 0 && counted > 0) process.exitCode = 1;
  console.log(output.summary(startedAt));
  console.log(outputCounts(counts.funds, counts.holdings, counts.history));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Schwab data update\n\n- updated: ${results.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`, 'utf8');
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for an equity row (assetCat EC or EP) traded in USD with a U.S. ISIN or none, and never one ticker on two
 *   different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/** A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped). */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const text = value.toFixed(digits);
  return text.indexOf('.') < 0 ? text : text.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/", "US BANCORP \DE\"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?)+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/** SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too). */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
  }
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to an equity row (assetCat EC or
 * EP) traded in USD (or with no currency) whose ISIN is U.S. or missing: first the filer's own `<ticker value>`, else the
 * SEC issuer-name table (`names`) when the row has a CUSIP or a U.S. ISIN. A ticker that lands on two different securities
 * (Alphabet A and C, an ordinary share and its ADR) is dropped from the name-matched rows; when the filer itself gave it
 * to two securities it is dropped from all of them. Bonds, cash, funds and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = (position.assetCat === 'EC' || position.assetCat === 'EP') && !position.derivative;
    const usd = !position.currency || position.currency === 'USD';
    if (!equity || !usd || (position.isin && position.isin.slice(0, 2) !== 'US')) return '';
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker)) {
      fromFiler[index] = true;
      return position.ticker;
    }
    if (!names || !(/^[0-9A-Z]{9}$/.test(position.cusip) || /^US[0-9A-Z]{10}$/.test(position.isin))) return '';
    const key = nportNameKey(position.name);
    return names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  return tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>
