'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { GoogleAuth } = require('google-auth-library');
const yauzl = require('yauzl');
const { DriveHistorySource } = require('./drive_history');

const MOPS_BASE = 'https://mops.twse.com.tw/mops/web';
const SECURITY_BLOCK = /FOR SECURITY REASONS|安全性考量.*無法呈現/i;
const MOPS_ARCHIVE_BASE = 'https://mopsov.twse.com.tw/server-java/FileDownLoad';

const DATASETS = Object.freeze({
  monthlyRevenue: Object.freeze({ endpoint: 'ajax_t21sc03', period: 'month' }),
  incomeStatement: Object.freeze({ endpoint: 'ajax_t163sb04', period: 'quarter' }),
  balanceSheet: Object.freeze({ endpoint: 'ajax_t163sb05', period: 'quarter' }),
  cashFlow: Object.freeze({ endpoint: 'ajax_t163sb20', period: 'quarter' }),
  majorMessages: Object.freeze({ endpoint: 'ajax_t05st01', period: 'year' })
});

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function rocYear(year) { return Number(year) - 1911; }
function cleanText(value) {
  return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

function parseHtmlTables(html) {
  return [...String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table =>
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => cleanText(cell[1]))
    ).filter(row => row.length)
  ).filter(table => table.length);
}

function rowsFromTable(table) {
  if (!table?.length) return [];
  const headerIndex = table.findIndex(row => row.some(cell => /公司代號|公司名稱|發言日期|營業收入/.test(cell)));
  if (headerIndex < 0) return [];
  const header = table[headerIndex].map((name, index) => name || `欄位${index + 1}`);
  return table.slice(headerIndex + 1).filter(row => row.length >= 2).map(row =>
    Object.fromEntries(header.map((name, index) => [name, row[index] ?? '']))
  );
}

function normalizeSymbol(value) {
  const match = String(value || '').match(/\b\d{4}\b/);
  return match ? match[0] : '';
}

function canonicalRow(dataset, raw, context) {
  const symbol = normalizeSymbol(raw['公司代號'] || raw['公司代碼'] || raw['代號']);
  const filingDate = raw['發言日期'] || raw['申報日期'] || raw['出表日期'] || '';
  const filingTime = raw['發言時間'] || raw['申報時間'] || '';
  const row = {
    dataset,
    stock_code: symbol,
    stock_name: raw['公司名稱'] || raw['公司簡稱'] || '',
    fiscal_year: context.year,
    month: context.month || '',
    quarter: context.quarter || '',
    filing_date: filingDate,
    filing_time: filingTime,
    available_from: filingDate ? `${filingDate}${filingTime ? ` ${filingTime}` : ''}` : '',
    source: 'MOPS',
    source_url: context.sourceUrl,
    raw
  };
  row.content_hash = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
  return row;
}

function requestParams(dataset, year, part) {
  const common = { encodeURIComponent: '1', step: '1', firstin: '1', off: '1', TYPEK: 'sii', year: String(rocYear(year)) };
  if (dataset === 'monthlyRevenue') return { ...common, month: String(part).padStart(2, '0') };
  if (dataset === 'majorMessages') return { ...common, month: '' };
  return { ...common, season: String(part) };
}

function xbrlArchiveUrl(year, quarter) {
  const fileName = `tifrs-${year}Q${quarter}.zip`;
  return `${MOPS_ARCHIVE_BASE}?${new URLSearchParams({ step: '9', functionName: 'show_file2', fileName, filePath: `/ifrs/${year}/` })}`;
}

const CORE_FACT_PATTERNS = Object.freeze({
  revenue: /(?:^|:)(?:Revenue|Revenues|OperatingRevenue|TotalOperatingRevenue)$/i,
  operating_income: /(?:^|:)(?:OperatingIncome|OperatingProfitLoss)$/i,
  net_income: /(?:^|:)(?:ProfitLoss|NetIncomeLoss|ProfitLossAttributableToOwnersOfParent)$/i,
  eps: /(?:^|:)(?:BasicEarningsLossPerShare|BasicEarningsPerShare)$/i,
  assets: /(?:^|:)(?:Assets|TotalAssets)$/i,
  liabilities: /(?:^|:)(?:Liabilities|TotalLiabilities)$/i,
  equity: /(?:^|:)(?:Equity|EquityAttributableToOwnersOfParent|TotalEquity)$/i,
  cash: /(?:^|:)(?:CashAndCashEquivalents|CashAndCashEquivalentsAtCarryingValue)$/i,
  operating_cash_flow: /(?:^|:)(?:NetCashFlowsFromUsedInOperatingActivities|NetCashProvidedByUsedInOperatingActivities)$/i
});

function archiveEntryIdentity(name) {
  const match = String(name || '').match(/-([a-z]{2})-(\d{4})-(\d{4})Q([1-4])\.(?:xml|html|xhtml)$/i);
  return match ? { report_variant: match[1].toLowerCase(), stock_code: match[2], fiscal_year: Number(match[3]), quarter: Number(match[4]) } : null;
}

function xmlValue(value) {
  return cleanText(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

function parseContexts(xml) {
  const contexts = new Map();
  for (const match of String(xml).matchAll(/<(?:[\w.-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?context>/gi)) {
    const body = match[2];
    const identifier = body.match(/<(?:[\w.-]+:)?identifier\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?identifier>/i)?.[1] || '';
    contexts.set(match[1], {
      stock_code: normalizeSymbol(xmlValue(identifier)),
      start_date: xmlValue(body.match(/<(?:[\w.-]+:)?startDate>([\s\S]*?)<\/(?:[\w.-]+:)?startDate>/i)?.[1]),
      end_date: xmlValue(body.match(/<(?:[\w.-]+:)?endDate>([\s\S]*?)<\/(?:[\w.-]+:)?endDate>/i)?.[1]),
      instant: xmlValue(body.match(/<(?:[\w.-]+:)?instant>([\s\S]*?)<\/(?:[\w.-]+:)?instant>/i)?.[1]),
      dimensional: /<(?:[\w.-]+:)?scenario\b/i.test(body)
    });
  }
  return contexts;
}

function parseXbrlInstance(xml, identity, sourceUrl) {
  const contexts = parseContexts(xml);
  const facts = [];
  const factPattern = /<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b([^>]*)\bcontextRef="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const match of String(xml).matchAll(factPattern)) {
    const concept = match[1];
    const metric = Object.entries(CORE_FACT_PATTERNS).find(([, pattern]) => pattern.test(concept))?.[0];
    if (!metric) continue;
    const context = contexts.get(match[3]);
    if (!context || context.dimensional || (context.stock_code && context.stock_code !== identity.stock_code)) continue;
    const text = xmlValue(match[5]).replaceAll(',', '');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) continue;
    const attributes = `${match[2]} ${match[4]}`;
    facts.push({
      metric, concept, value: Number(text), context_ref: match[3], start_date: context.start_date,
      end_date: context.end_date, instant: context.instant,
      unit: attributes.match(/\bunitRef="([^"]+)"/i)?.[1] || '',
      decimals: attributes.match(/\bdecimals="([^"]+)"/i)?.[1] || ''
    });
  }
  const inlinePattern = /<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  for (const match of String(xml).matchAll(inlinePattern)) {
    const attributes = match[1];
    const concept = attributes.match(/\bname="([^"]+)"/i)?.[1] || '';
    const metric = Object.entries(CORE_FACT_PATTERNS).find(([, pattern]) => pattern.test(concept))?.[0];
    const contextRef = attributes.match(/\bcontextRef="([^"]+)"/i)?.[1] || '';
    const context = contexts.get(contextRef);
    if (!metric || !context || context.dimensional || (context.stock_code && context.stock_code !== identity.stock_code)) continue;
    const text = xmlValue(match[2]).replaceAll(',', '').replaceAll(' ', '');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) continue;
    const scale = Number(attributes.match(/\bscale="(-?\d+)"/i)?.[1] || 0);
    const sign = attributes.match(/\bsign="-"/i) ? -1 : 1;
    facts.push({
      metric, concept, value: Number(text) * (10 ** scale) * sign, context_ref: contextRef,
      start_date: context.start_date, end_date: context.end_date, instant: context.instant,
      unit: attributes.match(/\bunitRef="([^"]+)"/i)?.[1] || '',
      decimals: attributes.match(/\bdecimals="([^"]+)"/i)?.[1] || ''
    });
  }
  return {
    dataset: 'quarterlyFinancials', ...identity, source: 'MOPS_XBRL', source_url: sourceUrl,
    filing_date: '', filing_time: '', available_from: '', facts,
    content_hash: crypto.createHash('sha256').update(String(xml)).digest('hex')
  };
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => error ? reject(error) : resolve(zip)));
}

async function validZipFile(zipPath) {
  try { const zip = await openZip(zipPath); zip.close(); return true; } catch { return false; }
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error) return reject(error);
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  }));
}

async function parseXbrlArchive(zipPath, allowedSymbols, options = {}) {
  const zip = await openZip(zipPath);
  const sourceUrl = options.sourceUrl || '';
  const records = [];
  return new Promise((resolve, reject) => {
    zip.once('error', reject);
    zip.once('end', () => resolve(records));
    zip.on('entry', async entry => {
      try {
        const identity = archiveEntryIdentity(entry.fileName);
        if (!identity || !allowedSymbols.has(identity.stock_code)) return zip.readEntry();
        const xml = await readEntry(zip, entry);
        records.push(parseXbrlInstance(xml, identity, sourceUrl));
        zip.readEntry();
      } catch (error) { reject(error); zip.close(); }
    });
    zip.readEntry();
  });
}

function filingKey(row) { return `${row.stock_code}:${row.fiscal_year}:Q${row.quarter}`; }

function dedupeCompanyQuarters(records) {
  const preference = { cr: 3, ir: 2, er: 1 };
  const selected = new Map();
  const suppressed = [];
  for (const row of records || []) {
    const key = filingKey(row);
    const current = selected.get(key);
    if (!current) { selected.set(key, row); continue; }
    const rowRank = preference[row.report_variant] || 0;
    const currentRank = preference[current.report_variant] || 0;
    const replace = rowRank > currentRank || (rowRank === currentRank && (row.facts?.length || 0) > (current.facts?.length || 0));
    if (replace) { suppressed.push({ key, content_hash: current.content_hash, reason: 'less_preferred_report_variant' }); selected.set(key, row); }
    else suppressed.push({ key, content_hash: row.content_hash, reason: 'less_preferred_report_variant' });
  }
  return { records: [...selected.values()], suppressed };
}

function attachFilingTimes(records, filingRows) {
  const index = new Map((filingRows || []).filter(row => row.stock_code && row.filing_date && row.filing_time)
    .map(row => [filingKey(row), row]));
  return records.map(record => {
    const filing = index.get(filingKey(record));
    if (!filing) return record;
    return { ...record, filing_date: filing.filing_date, filing_time: filing.filing_time,
      available_from: `${filing.filing_date}T${filing.filing_time}`, filing_source_url: filing.source_url || '' };
  });
}

function validateMopsCompleteness(input) {
  const expectedArchives = Number(input.expectedArchives || 40);
  const archives = input.archives || [];
  const financials = input.financials || [];
  const missingFilingTimes = financials.filter(row => !row.available_from).map(filingKey);
  const checks = {
    xbrl_archives: archives.length === expectedArchives,
    xbrl_records: financials.length > 0,
    filing_times: missingFilingTimes.length === 0,
    monthly_revenue: input.monthlyRevenueComplete === true,
    major_messages: input.majorMessagesComplete === true
  };
  return { passed: Object.values(checks).every(Boolean), checks, counts: {
    archives: archives.length, financial_records: financials.length, missing_filing_times: missingFilingTimes.length
  }, missing_filing_time_keys: missingFilingTimes.slice(0, 100) };
}

function validateOfficialBatch(manifest, rows, options = {}) {
  const allowedKinds = new Set(['MOPS_OFFICIAL_BATCH', 'TWSE_OPENAPI_ARCHIVE', 'LICENSED_API']);
  const start = options.coverageStart || '2016-01-01';
  const end = options.coverageEnd || '2025-12-31';
  const items = rows || [];
  const timestamped = items.every(row => row.available_from && row.source_url);
  const checks = {
    trusted_source: allowedKinds.has(manifest?.source_kind),
    declared_complete: manifest?.complete === true,
    coverage: String(manifest?.coverage_start || '') <= start && String(manifest?.coverage_end || '') >= end,
    record_count: Number(manifest?.record_count) === items.length,
    checksum: /^[a-f0-9]{64}$/i.test(String(manifest?.content_sha256 || '')),
    timestamps_and_sources: timestamped
  };
  if (options.dataset === 'monthlyRevenue') {
    const periods = new Set(items.map(row => `${row.fiscal_year}-${String(row.month).padStart(2, '0')}`));
    checks.monthly_periods = periods.size === Number(options.expectedMonths || 120);
  }
  return { passed: Object.values(checks).every(Boolean), checks, rows: items.length };
}

async function top50SymbolSet(options = {}) {
  if (options.symbols) return new Set(options.symbols.map(normalizeSymbol).filter(Boolean));
  const source = options.historySource || new DriveHistorySource(options);
  const rows = await source.top50Rows(options.startDate || '2016-01-01', options.endDate || '2025-12-31');
  return new Set(rows.map(row => normalizeSymbol(row.stock_code)).filter(Boolean));
}

async function downloadXbrlArchives(options = {}) {
  const startYear = Number(options.startYear || 2016);
  const endYear = Number(options.endYear || new Date().getFullYear());
  const outputDir = path.resolve(options.outputDir || 'tmp/mops-history/xbrl');
  const fetchImpl = options.fetchImpl || fetch;
  fs.mkdirSync(outputDir, { recursive: true });
  const files = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (const quarter of [1, 2, 3, 4]) {
      const name = `tifrs-${year}Q${quarter}.zip`;
      const target = path.join(outputDir, name);
      if (fs.existsSync(target) && fs.statSync(target).size > 4) {
        files.push({ year, quarter, name, bytes: fs.statSync(target).size, resumed: true });
        continue;
      }
      const response = await fetchImpl(xbrlArchiveUrl(year, quarter), {
        headers: { accept: 'application/zip,application/octet-stream', 'user-agent': 'tw-stock-bot-mops-history/1.0 (+official-XBRL-bulk-download)' },
        signal: AbortSignal.timeout(30 * 60 * 1000)
      });
      if (response.status === 404 || response.status === 500) continue;
      if (!response.ok || !response.body) throw new Error(`MOPS XBRL ${year}Q${quarter} HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${target}.part`));
      const signature = Buffer.alloc(4);
      const handle = fs.openSync(`${target}.part`, 'r');
      fs.readSync(handle, signature, 0, 4, 0); fs.closeSync(handle);
      if (signature.toString('hex') !== '504b0304') throw new Error(`MOPS XBRL ${year}Q${quarter} is not a ZIP archive`);
      fs.renameSync(`${target}.part`, target);
      files.push({ year, quarter, name, bytes: fs.statSync(target).size, source_url: xbrlArchiveUrl(year, quarter) });
    }
  }
  return files;
}

async function downloadXbrlArchive(year, quarter, options = {}) {
  const outputDir = path.resolve(options.outputDir || 'tmp/mops-history/xbrl');
  const fetchImpl = options.fetchImpl || fetch;
  fs.mkdirSync(outputDir, { recursive: true });
  const name = `tifrs-${year}Q${quarter}.zip`;
  const target = path.join(outputDir, name);
  if (fs.existsSync(target) && !(await validZipFile(target))) fs.unlinkSync(target);
  if (!fs.existsSync(target) || fs.statSync(target).size <= 4) {
    const response = await fetchImpl(xbrlArchiveUrl(year, quarter), {
      headers: { accept: 'application/zip,application/octet-stream', 'user-agent': 'tw-stock-bot-mops-history/1.0 (+official-XBRL-bulk-download)' },
      signal: AbortSignal.timeout(30 * 60 * 1000)
    });
    if (!response.ok || !response.body) throw new Error(`MOPS XBRL ${year}Q${quarter} HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${target}.part`));
    const signature = Buffer.alloc(4);
    const handle = fs.openSync(`${target}.part`, 'r');
    fs.readSync(handle, signature, 0, 4, 0); fs.closeSync(handle);
    if (signature.toString('hex') !== '504b0304') throw new Error(`MOPS XBRL ${year}Q${quarter} is not a ZIP archive`);
    fs.renameSync(`${target}.part`, target);
  }
  if (!(await validZipFile(target))) {
    fs.unlinkSync(target);
    const attempt = Number(options.attempt || 1);
    if (attempt >= 3) throw new Error(`MOPS XBRL ${year}Q${quarter} remained truncated after ${attempt} attempts`);
    await sleep(1500 * attempt);
    return downloadXbrlArchive(year, quarter, { ...options, attempt: attempt + 1 });
  }
  return { year, quarter, name, bytes: fs.statSync(target).size, source_url: xbrlArchiveUrl(year, quarter), target };
}

async function buildQuarterlyXbrlHistory(options = {}) {
  const startYear = Number(options.startYear || 2016);
  const endYear = Number(options.endYear || 2025);
  const quarters = options.quarters || [1, 2, 3, 4];
  const outputDir = path.resolve(options.outputDir || 'tmp/mops-history');
  const symbols = await top50SymbolSet({ ...options, startDate: `${startYear}-01-01`, endDate: `${endYear}-12-31` });
  const archives = [];
  const financials = [];
  fs.mkdirSync(path.join(outputDir, 'staging'), { recursive: true });
  for (let year = startYear; year <= endYear; year += 1) {
    for (const quarter of quarters) {
      const stagingFile = path.join(outputDir, 'staging', `quarterly_${year}Q${quarter}.jsonl`);
      if (options.resume !== false && fs.existsSync(stagingFile) && fs.statSync(stagingFile).size > 2) {
        const rows = fs.readFileSync(stagingFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        financials.push(...rows);
        archives.push({ year, quarter, name: `tifrs-${year}Q${quarter}.zip`, bytes: null, source_url: xbrlArchiveUrl(year, quarter), resumed: true });
        options.onQuarter?.({ year, quarter, records: rows.length, resumed: true });
        continue;
      }
      const archive = await downloadXbrlArchive(year, quarter, { outputDir: path.join(outputDir, 'xbrl'), fetchImpl: options.fetchImpl });
      archives.push(archive);
      const rows = await parseXbrlArchive(archive.target, symbols, { sourceUrl: archive.source_url });
      financials.push(...rows);
      fs.writeFileSync(stagingFile,
        `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
      options.onQuarter?.({ year, quarter, records: rows.length, bytes: archive.bytes });
      if (options.removeArchivesAfterParse) fs.unlinkSync(archive.target);
    }
  }
  const filingRows = options.filingRows || [];
  const enriched = attachFilingTimes(financials, filingRows);
  const validation = validateMopsCompleteness({
    expectedArchives: (endYear - startYear + 1) * quarters.length, archives, financials: enriched,
    monthlyRevenueComplete: options.monthlyRevenueComplete,
    majorMessagesComplete: options.majorMessagesComplete
  });
  const manifest = {
    dataset: 'MOPS_10Y', generated_at: new Date().toISOString(), start_year: startYear, end_year: endYear,
    top50_symbols: symbols.size, status: validation.passed ? 'complete' : 'incomplete', validation,
    archives: archives.map(({ year, quarter, name, bytes, source_url }) => ({ year, quarter, name, bytes, source_url }))
  };
  fs.writeFileSync(path.join(outputDir, 'mops_10y_validation.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (validation.passed) {
    const finalDir = path.join(outputDir, 'MOPS_10Y');
    fs.mkdirSync(finalDir, { recursive: true });
    for (let year = startYear; year <= endYear; year += 1) {
      const rows = enriched.filter(row => row.fiscal_year === year);
      fs.writeFileSync(path.join(finalDir, `quarterly_financials_${year}.jsonl`), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
    }
    fs.writeFileSync(path.join(finalDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { manifest, archives, financials: enriched };
}

class MopsClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.delayMs = Number(options.delayMs ?? 1500);
    this.maxAttempts = Number(options.maxAttempts ?? 4);
  }

  async query(dataset, year, part) {
    const definition = DATASETS[dataset];
    if (!definition) throw new Error(`unknown MOPS dataset: ${dataset}`);
    const sourceUrl = `${MOPS_BASE}/${definition.endpoint}`;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const response = await this.fetchImpl(sourceUrl, {
        method: 'POST',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://mops.twse.com.tw',
          referer: `${MOPS_BASE}/${definition.endpoint.replace('ajax_', '')}`,
          'user-agent': 'tw-stock-bot-mops-history/1.0 (+official-public-data; low-rate)'
        },
        body: new URLSearchParams(requestParams(dataset, year, part)),
        signal: AbortSignal.timeout(120000)
      });
      const html = await response.text();
      if (SECURITY_BLOCK.test(html)) throw new Error('MOPS_SECURITY_BLOCK: 官方網站拒絕自動查詢；請改用官方XBRL整批下載檔或經授權介面');
      if (response.ok) {
        const context = { year, sourceUrl, month: definition.period === 'month' ? part : '', quarter: definition.period === 'quarter' ? part : '' };
        const rows = parseHtmlTables(html).flatMap(rowsFromTable).map(row => canonicalRow(dataset, row, context));
        await sleep(this.delayMs);
        return rows;
      }
      if (attempt === this.maxAttempts) throw new Error(`MOPS ${dataset} HTTP ${response.status}`);
      await sleep(this.delayMs * attempt);
    }
  }
}

function csvEscape(value) {
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const header = ['dataset', 'stock_code', 'stock_name', 'fiscal_year', 'month', 'quarter', 'filing_date', 'filing_time', 'available_from', 'source', 'source_url', 'content_hash', 'raw'];
  return `${header.join(',')}\n${rows.map(row => header.map(key => csvEscape(row[key])).join(',')).join('\n')}\n`;
}

class DriveFolderWriter {
  constructor(options = {}) {
    this.parentId = options.parentId;
    this.fetchImpl = options.fetchImpl || fetch;
    this.auth = options.auth || new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.file'] });
  }

  async headers() { return (await this.auth.getClient()).getRequestHeaders(); }

  async findOrCreateFolder(name) {
    if (!this.parentId) throw new Error('DRIVE_PARENT_FOLDER_ID is required');
    const headers = await this.headers();
    const q = `'${this.parentId}' in parents and name='${name.replaceAll("'", "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const found = await this.fetchImpl(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { headers });
    if (!found.ok) throw new Error(`Drive list HTTP ${found.status}`);
    const files = (await found.json()).files || [];
    if (files[0]) return files[0].id;
    const created = await this.fetchImpl('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [this.parentId] })
    });
    if (!created.ok) throw new Error(`Drive create folder HTTP ${created.status}`);
    return (await created.json()).id;
  }

  async upload(folderId, name, content, mimeType = 'text/csv') {
    const headers = await this.headers();
    const boundary = `mops-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: [folderId] });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
    const response = await this.fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST', headers: { ...headers, 'content-type': `multipart/related; boundary=${boundary}` }, body
    });
    if (!response.ok) throw new Error(`Drive upload ${name} HTTP ${response.status}`);
    return response.json();
  }
}

async function downloadMopsHistory(options = {}) {
  const startYear = Number(options.startYear || 2016);
  const endYear = Number(options.endYear || new Date().getFullYear());
  const outputDir = path.resolve(options.outputDir || 'tmp/mops-history');
  const client = options.client || new MopsClient(options);
  const writer = options.driveParentId ? new DriveFolderWriter({ parentId: options.driveParentId }) : null;
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = { dataset: 'MOPS_10Y', generated_at: new Date().toISOString(), start_year: startYear, end_year: endYear, status: 'running', files: [], xbrl_archives: [], errors: [] };
  if (options.downloadXbrlArchives) {
    manifest.xbrl_archives = await downloadXbrlArchives({ startYear, endYear, outputDir: path.join(outputDir, 'xbrl'), fetchImpl: options.fetchImpl });
  }
  for (const dataset of ['monthlyRevenue', 'majorMessages']) {
    const folderId = writer ? await writer.findOrCreateFolder(dataset) : null;
    for (let year = startYear; year <= endYear; year += 1) {
      const parts = DATASETS[dataset].period === 'month' ? Array.from({ length: 12 }, (_, i) => i + 1)
        : DATASETS[dataset].period === 'quarter' ? [1, 2, 3, 4] : [null];
      const rows = [];
      try {
        for (const part of parts) rows.push(...await client.query(dataset, year, part));
        const unique = [...new Map(rows.filter(row => row.stock_code).map(row => [row.content_hash, row])).values()];
        const name = `${dataset}_${year}.csv`;
        const content = toCsv(unique);
        fs.writeFileSync(path.join(outputDir, name), content);
        const driveFile = writer ? await writer.upload(folderId, name, content) : null;
        manifest.files.push({ dataset, year, name, rows: unique.length, drive_file_id: driveFile?.id || null });
      } catch (error) {
        manifest.errors.push({ dataset, year, error: String(error.message || error) });
        if (/MOPS_SECURITY_BLOCK/.test(String(error))) break;
      }
    }
  }
  manifest.status = manifest.errors.length ? 'incomplete' : 'complete';
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (writer) {
    const root = await writer.findOrCreateFolder('manifests');
    await writer.upload(root, 'mops_10y_manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'application/json');
  }
  return manifest;
}

module.exports = {
  CORE_FACT_PATTERNS, DATASETS, DriveFolderWriter, MopsClient, SECURITY_BLOCK,
  archiveEntryIdentity, attachFilingTimes, buildQuarterlyXbrlHistory, canonicalRow, cleanText, dedupeCompanyQuarters,
  downloadMopsHistory, downloadXbrlArchive, downloadXbrlArchives, parseContexts, parseHtmlTables, parseXbrlArchive,
  parseXbrlInstance, requestParams, rowsFromTable, toCsv, top50SymbolSet,
  validZipFile, validateMopsCompleteness, validateOfficialBatch, xbrlArchiveUrl
};
