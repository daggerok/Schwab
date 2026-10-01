/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';

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
  expect(readConfig(resolveControls({ MAX_RETRIES: 0 })).maxRetries).toBe(0);
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  const defaults = file();
  const scheduled = resolveControls(defaults, JSON.parse('{}'), {}, {});
  expect(scheduled).toEqual(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])));
});

test('resolver rejects unknown keys, invalid values, non-scalars and newline injection', () => {
  for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'maybe' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'a:b' }, { TICKERS: ['SCHD'] }, { TICKERS: { a: 1 } }, null, []]) {
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
  expect(config.storeRawDownloads).toBe(false);
  expect(config.tickers).toBeNull();
  expect(config.aum).toBeUndefined();
  expect(config.ter).toBeUndefined();
  expect(config.dividendYield).toBeUndefined();
  expect(config.performance).toEqual({});
  expect(config.totalReturn).toEqual({});
  expect(file().SEC_UA).toBe('');
  expect(config.secUa).toContain('Schwab');
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
  expect(yml).toContain('git add api/schwab\n');
  expect(yml.match(/git add /g)?.length).toBe(1);
  expect(yml).not.toContain('OUTPUT_DIR');
});
