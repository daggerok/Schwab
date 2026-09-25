#!/usr/bin/env bun
import { hasOutputFilters, printConfig, printFilter, createReporter } from './update-output.ts';

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

// Bun provides Node-compatible fs/promises; node types are intentionally not required at runtime.
/// <reference types="bun" />
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

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
const SEC_UA = 'DaggerOk Schwab ETF feed admin@daggerok.example.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROXY_SLEEP_SECONDS = 3.2; // r.jina.ai anonymous tier is ~20 requests per minute

const API_ROOT = new URL('../api/schwab/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
const BOND_HOLDINGS_HEADERS = [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'];
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

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: JsonRecord[];
  totalValue: number;
  netAssets: number | null;
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
};

export type HoldingsCsv = { headers: string[]; rows: JsonRecord[]; asOfDate: string | null; bond: boolean };
export type Distribution = { epoch: number; amount: number };

type SecSeriesRef = { cik: string; seriesId: string; classId: string };
type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
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
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

let requestGateAt = 0;
let proxyGateAt = 0;
let requestSleepSeconds = 1.5;
let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let fundTickerMapPromise: Promise<Map<string, SecSeriesRef>> | null = null;
let companyTickerMap: Map<string, string> | null = null;
let companyTickerMapPromise: Promise<Map<string, string>> | null = null;

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
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])} ${match[1]}`;
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

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') result[period] = parseRange(value, `${prefix}_${period}`);
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const tickers = String(value ?? '').split(/[\s,;]+/).map(sanitizeTicker).filter(Boolean);
  return tickers.length ? new Set(tickers) : null;
}

function hasConfiguredFilters(config: UpdaterConfig): boolean {
  return Boolean(config.aum || config.ter || config.dividendYield || config.tickers || Object.keys(config.performance).length || Object.keys(config.totalReturn).length);
}

function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 1.5),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, 3)),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000)),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: Math.max(0, parsePositiveInt(env.MAX_RETRIES, 2)),
    tickers: readTickerSet(env.TICKERS),
    historyRange: env.HISTORY_RANGE?.trim() || 'max',
    edgarFallback: !['0', 'false', 'off', 'no'].includes(String(env.EDGAR_FALLBACK ?? '1').toLowerCase()),
    skipSchwab: parseBoolean(env.SKIP_SCHWAB),
    skipYahoo: parseBoolean(env.SKIP_YAHOO),
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

async function paceRequests(proxy = false): Promise<void> {
  const now = Date.now();
  if (proxy) {
    const wait = Math.max(0, proxyGateAt - now);
    proxyGateAt = Math.max(now, proxyGateAt) + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
    if (wait) await sleep(wait);
    return;
  }
  const wait = Math.max(0, requestGateAt - now);
  requestGateAt = Math.max(now, requestGateAt) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
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

async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await paceRequests(proxy);
      const response = await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: '*/*', ...headers }, redirect: 'follow' });
      if (!response.ok) {
        const snippet = cleanText((await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ')).slice(0, 160);
        throw new HttpError(response.status, `${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || !retryable(error)) break;
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
        if (issuerDirectDenials === ISSUER_DIRECT_DENIAL_LIMIT) console.warn('[issuer  ] direct requests are denied from this network; using the read-only rendering proxy for the rest of the run');
      }
    }
  }
  try {
    const headers: Record<string, string> = { 'User-Agent': SEC_UA, Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8' };
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
    officialReturns: parseOfficialReturns(lines, upper),
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
  };
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
    const symbol = isBondRow || !symbolRaw || ['-', '--', 'N/A', 'NA', 'NONE', 'NULL'].includes(symbolRaw) ? '-' : symbolRaw;
    const figi = at(row, col.figi).toUpperCase();
    const cusip = at(row, col.cusip).toUpperCase();
    const weight = numberOrNull(at(row, col.weight));
    const marketValue = weight !== null && netAssets !== null ? String(round(weight / 100 * netAssets, 2)) : '-';
    const item: JsonRecord = {
      Name: name,
      Ticker: symbol,
      Identifier: figi || cusip || '-',
      Weight: weight === null ? '0' : String(round(weight, 6)),
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
// SEC EDGAR Form N-PORT-P fallback (same resolver as daggerok/WisdomTree)
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { 'User-Agent': SEC_UA, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const result = new Map<string, SecSeriesRef>();
  const fields = Array.isArray(payload?.fields) ? payload.fields.map(String) : [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const at = (field: string) => String(row[fields.indexOf(field)] ?? '');
    const ticker = sanitizeTicker(at('symbol'));
    const cik = at('cik').replace(/\D/g, '');
    const seriesId = at('seriesId').toUpperCase();
    const classId = at('classId').toUpperCase();
    if (ticker && cik && seriesId && !result.has(ticker)) result.set(ticker, { cik: cik.padStart(10, '0'), seriesId, classId });
  }
  return result;
}

function unescapeXml(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function tagValue(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_.-]+):)?${escaped}>`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1].replace(/<[^>]+>/g, ' '))) : '';
}

function tagAttribute(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${tag}\\b[^>]*\\b${attribute}="([^"]*)"`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1])) : '';
}

export function nportUrlFor(cik: string, accession: string): string {
  const digits = String(cik).replace(/\D/g, '').replace(/^0+/, '') || '0';
  const acc = String(accession).replace(/-/g, '');
  // The raw submission text is the stable machine-readable public document for
  // NPORT-P filings; primary_doc.xml is often only the EDGAR submission header
  // or an XSL-rendered HTML view.
  return `${SEC_ARCHIVES}/${digits}/${acc}/${accession}.txt`;
}

export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const match of String(xml ?? '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = match[1];
    const type = (tagValue(body, 'filing-type') || '').toUpperCase();
    if (type && type !== 'NPORT-P') continue;
    if (/<amend>/i.test(body)) continue;
    const accession = tagValue(body, 'accession-number');
    if (!accession) continue;
    const href = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body)?.[1] || '';
    const cik = /\/data\/(\d+)\//i.exec(unescapeXml(href))?.[1] || '';
    result.push({ accession, filed: tagValue(body, 'filing-date'), reportDate: tagValue(body, 'period'), url: nportUrlFor(cik, accession) });
  }
  return result;
}

export function parseNport(xml: string): ParsedNport {
  const text = String(xml ?? '');
  const genInfo = /<genInfo\b[^>]*>([\s\S]*?)<\/genInfo>/i.exec(text)?.[1] || text.slice(0, 5000);
  const fundInfo = /<fundInfo\b[^>]*>([\s\S]*?)<\/fundInfo>/i.exec(text)?.[1] || '';
  const holdings: JsonRecord[] = [];
  let totalValue = 0;
  for (const match of text.matchAll(/<invstOrSec\b[^>]*>([\s\S]*?)<\/invstOrSec>/gi)) {
    const body = match[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    const identifier = cusip && !/^n\/?a$/i.test(cusip) ? cusip : tagAttribute(body, 'isin', 'value') || tagAttribute(body, 'other', 'value') || '-';
    const value = numberOrNull(tagValue(body, 'valUSD'));
    const weight = numberOrNull(tagValue(body, 'pctVal'));
    if (value !== null) totalValue += value;
    const debt = /<debtSec\b[^>]*>([\s\S]*?)<\/debtSec>/i.exec(body)?.[1] || '';
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier,
      Weight: weight === null ? '0' : String(weight),
      'Market Value': value === null ? '0' : String(value),
      'Shares Held': tagValue(body, 'balance') || '-',
      'Asset Category': tagValue(body, 'assetCat') || '-',
      ...(debt ? { Coupon: tagValue(debt, 'annualizedRt') || '-', Maturity: tagValue(debt, 'maturityDt') || '-' } : {}),
    });
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue: round(totalValue, 2),
    netAssets: numberOrNull(tagValue(fundInfo, 'netAssets')),
  };
}

export function normalizeHoldingName(value: unknown): string {
  let text = cleanText(value).toUpperCase().replace(/[’']/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\.?\s*([A-Z])\b/g, 'CL $1');
  const keepClass = text.match(/\bCL\s+[A-Z]\b/gi)?.[0] || '';
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|NV|AG|SE|SPA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (keepClass && !/\bCL\s+[A-Z]\b/.test(text)) text = `${text} ${keepClass}`.trim();
  return text;
}

export function normalizeHoldingNameCore(value: unknown): string {
  return normalizeHoldingName(value).replace(/\s+CL\s+[A-Z]\b/g, '').trim();
}

export function cleanHoldingTicker(value: unknown): string {
  const raw = cleanText(value).toUpperCase();
  if (!raw || ['-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'SEE FILE'].includes(raw)) return '';
  return raw.replace(/\s+/g, '');
}

function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of Object.values(payload || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as JsonRecord;
    const ticker = cleanHoldingTicker(row.ticker);
    const title = cleanText(row.title);
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) if (key && !map.has(key)) map.set(key, ticker);
  }
  return map;
}

async function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  if (fundTickerMapPromise) return fundTickerMapPromise;
  fundTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config, secHeaders());
    fundTickerMap = parseFundTickerMap(payload);
    console.log(`[edgar   ] SEC fund ticker table: ${fundTickerMap.size} share classes`);
    return fundTickerMap;
  })();
  try {
    return await fundTickerMapPromise;
  } finally {
    fundTickerMapPromise = null;
  }
}

async function loadCompanyTickerTable(config: UpdaterConfig): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  if (companyTickerMapPromise) return companyTickerMapPromise;
  companyTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config, secHeaders());
    companyTickerMap = parseCompanyTickerMap(payload);
    console.log(`[edgar   ] SEC company ticker table: ${companyTickerMap.size} issuer names`);
    return companyTickerMap;
  })();
  try {
    return await companyTickerMapPromise;
  } finally {
    companyTickerMapPromise = null;
  }
}

function fillNportTickers(rows: JsonRecord[], names: Map<string, string>): JsonRecord[] {
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    if ('Maturity' in row && row.Maturity !== '-') return row; // bonds stay identifier-keyed
    const ticker = names.get(normalizeHoldingName(row.Name)) || names.get(normalizeHoldingNameCore(row.Name)) || '';
    return ticker ? { ...row, Ticker: ticker } : row;
  });
}

async function resolveNportFiling(fund: CatalogFund, config: UpdaterConfig): Promise<{ ref: SecSeriesRef; accession: NportAccession } | null> {
  const table = await loadFundTickerTable(config);
  const ref = table.get(fund.ticker);
  if (!ref) return null;
  const params = new URLSearchParams({ action: 'getcompany', CIK: ref.seriesId, type: 'NPORT-P', owner: 'include', count: '10', output: 'atom' });
  const atom = await fetchText(`${SEC_BROWSE_URL}?${params.toString()}`, `[edgar   ] ${fund.ticker} filings`, config, secHeaders());
  const [accession] = parseEdgarAtomFilings(atom);
  return accession ? { ref, accession } : null;
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
    qtd: pctChange(start(anchor(ordered, quarterStart)), end),
    ytd: pctChange(start(anchor(ordered, yearStart)), end),
    yr1: pctChange(start(anchor(ordered, target(1))), end),
    cagr3y: annualized(start(anchor(ordered, target(3))), end, 3),
    cagr5y: annualized(start(anchor(ordered, target(5))), end, 5),
    cagr10y: annualized(start(anchor(ordered, target(10))), end, 10),
    siAnn: ordered.length > 1 ? annualized(ordered[0].adjClose, end, Math.max(1 / 365, (date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime()) / (365.25 * 86_400_000))) : null,
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
  if (!normalized || normalized === '-' || normalized === '—') return '00 - —';
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

const DERIVED_RETURNS_BASIS = 'adjusted market-price closes (Yahoo chart API), not official Schwab NAV returns';
const OFFICIAL_RETURNS_BASIS = 'official Schwab product-page NAV total returns (month-end) where published; Yahoo adjusted market-price closes for missing values';

function deriveMetrics(effective: PriceReturns, fund: CatalogFund, dividends: Distribution[], frequency: { paymentsPerYear: number | null }, price: number | null, official: boolean): JsonRecord {
  const latest = dividends[dividends.length - 1];
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
    secYield: fund.secYield,
    secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
    returnsBasis: official ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
  };
}

function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({ Date: formatDate(day.date), Close: String(day.close), 'Adj Close': String(day.adjClose), Volume: String(day.volume) }));
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
    grossTer: null,
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: numberOrNull(metrics.dividendYield),
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

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (await readFile(file, 'utf8') === text) return false;
  } catch {
    // New file.
  }
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, text, 'utf8');
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
  try {
    for (const name of await readdir(dir)) if (name.endsWith('.json') && !kept.has(name)) await rm(new URL(name, dir), { force: true });
  } catch {
    // Directory may not exist on a zero-row first run.
  }
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
}

function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  return reasons;
}

function postFetchFilterReasons(fund: CatalogFund, metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(numberOrNull(metrics.dividendYield), config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (annual[period] !== null && !rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (cumulative[period] !== null && !rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Per-fund pipeline
// ---------------------------------------------------------------------------

const PROVIDER_LABEL = 'Schwab Asset Management product finder + official product page + per-fund holdings/distribution CSV exports + SEC EDGAR Form N-PORT-P fallback + Yahoo Finance public chart API';

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  await mkdir(fundDir, { recursive: true });
  const previousMeta = await readPreviousMeta(fund.ticker);

  // 1. Official product page ---------------------------------------------------
  let summary: ProductPageSummary | null = null;
  let productVia: 'direct' | 'proxy' | null = null;
  if (!config.skipSchwab && fund.fundPage) {
    try {
      const page = await fetchIssuerText(fund.fundPage, `[product ] ${fund.ticker}`, config, (text) => /Total Expense Ratio|Fund Inception|Total Net Assets/i.test(text), undefined, { cache: false });
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
      if (summary.nav !== null) fund.nav = summary.nav;
      if (summary.totalNetAssets !== null) fund.netAssets = summary.totalNetAssets;
      if (summary.totalExpenseRatio !== null) fund.ter = summary.totalExpenseRatio;
      if (summary.premiumDiscount !== null) fund.premiumDiscount = summary.premiumDiscount;
      if (summary.secYield !== null) fund.secYield = summary.secYield;
      if (summary.distributionYield !== null) fund.dividendYield = summary.distributionYield;
      if (summary.navAsOfDate) fund.asOfDate = summary.navAsOfDate;
      if (summary.morningstarCategory) fund.categoryPath = `${fund.category} / ${summary.morningstarCategory}`;
    } catch (error) {
      console.warn(`[product ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!fund.isin && fund.cusip) fund.isin = isinFromCusip(fund.cusip);

  // 2. Holdings: issuer CSV -> N-PORT-P -> previous run ------------------------
  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders: string[] = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available from the issuer CSV export or a public SEC filing';
  let holdingsDownload: string | null = summary?.holdingsCsvUrl || null;
  let marketValueBasis: string | null = null;
  let nport: ParsedNport | null = null;
  if (!config.skipSchwab) {
    const candidates = summary?.holdingsCsvUrl ? [summary.holdingsCsvUrl] : holdingsCsvCandidates(fund.ticker, summary?.totalHoldingsAsOfDate || null);
    for (const url of candidates) {
      try {
        const csv = await fetchIssuerText(url, `[holdings] ${fund.ticker}`, config, isHoldingsCsv, 'text/csv,text/plain;q=0.9,*/*;q=0.8');
        const parsed = parseHoldingsCsv(csv.text, fund.netAssets);
        if (!parsed.rows.length) continue;
        holdingsRows = parsed.rows;
        holdingsHeaders = parsed.headers;
        holdingsAsOf = parsed.asOfDate;
        holdingsDownload = url;
        holdingsSource = `schwabassetmanagement.com full holdings CSV export (${url.split('/').pop()}${csv.via === 'proxy' ? ', via read-only rendering proxy' : ''})`;
        marketValueBasis = fund.netAssets !== null ? 'derived: Percent of Assets x Total Net Assets (the issuer CSV publishes weights, not values)' : 'not derivable: Total Net Assets unavailable in this run';
        break;
      } catch (error) {
        console.warn(`[holdings] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (!holdingsRows.length && config.edgarFallback) {
    try {
      const filing = await resolveNportFiling(fund, config);
      if (filing) {
        const parsed = parseNport(await fetchText(filing.accession.url, `[nport   ] ${fund.ticker}`, config, secHeaders()));
        const seriesMatches = !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.ref.seriesId.toUpperCase();
        if (seriesMatches && parsed.holdings.length) {
          const names = await loadCompanyTickerTable(config);
          holdingsRows = fillNportTickers(parsed.holdings, names);
          holdingsHeaders = holdingsRows.some((row) => 'Coupon' in row || 'Maturity' in row) ? BOND_HOLDINGS_HEADERS : HOLDINGS_HEADERS;
          holdingsAsOf = parsed.repPdDate || null;
          nport = parsed;
          holdingsDownload = filing.accession.url;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || 'n/a'})`;
          marketValueBasis = 'SEC Form N-PORT-P reported value (valUSD)';
        }
      }
    } catch (error) {
      console.warn(`[nport   ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
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
      console.warn(`[distrib ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 4. Yahoo chart: history + dividend fallback --------------------------------
  let chart: ParsedChart | null = null;
  let days: ChartDay[] = [];
  let historySource = 'Yahoo Finance public chart API (adjusted close)';
  if (!config.skipYahoo) {
    try {
      const query = new URLSearchParams({ period1: '0', period2: String(Math.floor(Date.now() / 1000) + 86_400), interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
      if (config.historyRange && config.historyRange !== 'max') query.set('range', config.historyRange);
      const payload = await fetchJson(`${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}?${query.toString()}`, `[chart   ] ${fund.ticker}`, config, { 'User-Agent': 'Mozilla/5.0' });
      chart = parseChart(payload);
      days = chart.days;
    } catch (error) {
      console.warn(`[chart   ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
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
  const effective = mergeOfficialReturns(derived, officialMonthly);
  const marketPrice = chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : numberOrNull(previous.closePriceValue));
  const nav = fund.nav ?? numberOrNull(previous.navValue);
  const metrics = deriveMetrics(effective, fund, dividends, frequency, nav ?? marketPrice, Boolean(officialMonthly));
  const skipReasons = postFetchFilterReasons(fund, metrics, config);
  if (skipReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: skipReasons };
  }

  // 6. Write sheets, meta.json and the index row --------------------------------
  const history = historyRows(days);
  const historyAsOf = derived.asOfDate || previousMeta?.history?.asOf || null;
  const holdingManifest = await writePages(fundDir, fund.ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
  if (marketValueBasis) holdingManifest.marketValueBasis = marketValueBasis;
  if (summary?.totalHoldings !== null && summary?.totalHoldings !== undefined) holdingManifest.publishedTotalHoldings = summary.totalHoldings;
  const historyManifest = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), history, config.historyPageSize, historyAsOf, historySource);
  const distributionFrequency = dividends.length ? frequency.frequency : (previousMeta?.distributions?.frequency || '—');
  const premiumDiscount = fund.premiumDiscount ?? (nav && marketPrice ? round((marketPrice / nav - 1) * 100, 2) : numberOrNull(previous.premiumDiscountValue));
  const netAssets = fund.netAssets ?? nport?.netAssets ?? numberOrNull(previous.aumValue);
  const asOfDate = fund.asOfDate || toIsoDate(previous.asOfDate) || null;
  const asOfLabel = asOfDate ? formatDate(asOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : '—';
  const marketPriceAsOfLabel = chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : (days.length ? formatDate(days[days.length - 1].date) : asOfLabel);
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  const returns: JsonRecord = {
    derivedFrom: officialMonthly ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
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

Environment variables (all filters use AND logic):
  MAX_FETCHES=0       all eligible funds; positive value is a resumable batch
  REQUEST_SLEEP=1.5   seconds between request starts (proxy requests >= 3.2s)
  CONCURRENCY=3       parallel fund workers; every request stays paced
  AUM=:\n  TER=:\n  DIVIDEND_YIELD=:\n  TICKERS="SCHD SCHX"  optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max
  MAX_RETRIES=2
  STORE_RAW_DOWNLOADS=off
  EDGAR_FALLBACK=1
  SKIP_SCHWAB=off     use the previously published catalog/product data
  SKIP_YAHOO=off      keep previously published history when possible

Examples:
  TICKERS="SCHD SCHX SCHZ" ./scripts/update-data.ts
  AUM="large:" TER=":0.10" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
`;

async function main(): Promise<void> {
  const config = readConfig();
  requestSleepSeconds = config.requestSleep;
  requestGateAt = 0;
  proxyGateAt = 0;
  issuerDirectDenials = 0;
  printConfig('Schwab', config);

  const previous = await readPreviousIndex();
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
      console.warn(`[catalog ] ${error instanceof Error ? error.message : String(error)} — keeping the published feed`);
    }
  }
  if (!catalog.size) for (const [ticker, row] of previous) catalog.set(ticker, parsePreviousFund(ticker, row));
  if (catalog.size && catalogSource !== 'previous api/schwab/index.json') for (const [ticker, row] of previous) if (!catalog.has(ticker)) catalog.set(ticker, parsePreviousFund(ticker, row));

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where www.schwabassetmanagement.com is reachable or seed api/schwab/index.json first.');
  console.log(`[catalog ] ${universe.length} Schwab ETFs (${catalogSource})`);

  let state: JsonRecord = {};
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord; } catch { state = {}; }
  const cursor = config.maxFetches > 0 ? String(state.cursor || '') : '';
  const index = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered = index >= 0 ? universe.slice(index + 1).concat(universe.slice(0, index + 1)) : universe;
  const queue = ordered.slice();
  const totalAttempts = config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length;
  const results: JsonRecord[] = [];
  let processed = 0;
  let failures = 0;
  let lastTicker: string | null = cursor || null;
  printFilter(universe.length, universe.length, hasOutputFilters(config));
  const output = createReporter(API_ROOT, totalAttempts);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (config.maxFetches > 0 && processed >= config.maxFetches) return;
      const fund = queue.shift();
      if (!fund) return;
      processed += 1;
      const before = await output.before(fund.ticker);
      try {
        const row = await processFund(fund, config, previous.get(fund.ticker) || {});
        if (row.__skipped) {
          await output.result(fund.ticker, before, 'skipped', (row.__skipReasons || ['not eligible']).join(', '));
        } else {
          results.push(row);
          lastTicker = fund.ticker;
          await output.result(fund.ticker, before);
        }
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        const old = previous.get(fund.ticker);
        if (old && !hasConfiguredFilters(config)) results.push(old);
        await output.result(fund.ticker, before, 'failed', message);
      }
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const filterRun = hasConfiguredFilters(config);
  const funds = [...results].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  if (!filterRun) {
    for (const fund of universe) if (!funds.some((row) => row.ticker === fund.ticker)) {
      const old = previous.get(fund.ticker);
      if (old) funds.push(old);
    }
    funds.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  }
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, {
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
    counts,
    funds,
  });
  await writeIfChanged(STATE_FILE, { cursor: config.maxFetches > 0 ? lastTicker : null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  console.log(`[done    ] ${results.length} funds updated, ${failures} failures`);
  console.log(`[done    ] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Schwab data update\n\n- updated: ${results.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`, 'utf8');
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
