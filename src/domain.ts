import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';

export class InputError extends Error {}
export const hash = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
// JSON objects compare by content; array order remains significant.
export function canonicalJson(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const norm = (s: string) => s.normalize('NFKC').replace(/[\s\u3000]+/g, '').toUpperCase();
export function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new InputError(`${label}を入力してください`);
  return value.trim();
}
export function date(value: string): string {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) throw new InputError('日付は YYYY-MM-DD または YYYY/MM/DD が必要です');
  const [, y, m, d] = match;
  const key = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const parsed = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) throw new InputError('存在しない日付です');
  return key;
}
export function yen(value: string, signed = false): number | null {
  const s = value.trim();
  if (!s) return null;
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)) throw new InputError('金額は円単位の整数が必要です');
  const amount = Number(s.replaceAll(',', ''));
  if (!Number.isSafeInteger(amount) || (!signed && amount < 0)) throw new InputError('金額の範囲または符号が不正です');
  return amount;
}
export type Encoding = 'utf-8' | 'shift_jis';
export interface CsvMapping {
  date: string; description: string; deposit: string; withdrawal: string;
  bankId?: string; balance?: string; counterparty?: string; currency?: string;
}
export interface ParsedCsv { headers: string[]; rows: { values: Record<string, string>; line: number; endLine: number }[] }
export function readCsv(bytes: Buffer, encoding: Encoding, headerRow = 1): ParsedCsv {
  if (!['utf-8', 'shift_jis'].includes(encoding)) throw new InputError('文字コードを明示してください');
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 100) throw new InputError('ヘッダー行は1から100です');
  if (bytes.length > 10 * 1024 * 1024) throw new InputError('CSVは10MBまでです');
  const text = encoding === 'utf-8' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : iconv.decode(bytes, 'shift_jis');
  if (text.includes('\ufffd') || text.includes('\0')) throw new InputError('文字コード不一致またはバイナリファイルです');
  let records: { record: string[]; raw:string; info: { lines: number } }[];
  try { records = parse(text, { bom: true, skip_empty_lines: true, info: true, raw:true, from_line: headerRow, relax_column_count: true }) as unknown as typeof records; }
  catch { throw new InputError('CSVの引用符・改行を解析できません'); }
  if (!records.length) throw new InputError('CSVが空です');
  const headers = records[0].record.map(h => h.trim());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new InputError('ヘッダーが空または重複しています');
  const rows = records.slice(1).map(({ record, raw, info }) => {
    const recordText=raw.replace(/^(?:\r\n|\r|\n)+/,'').replace(/(?:\r\n|\r|\n)$/,'');
    const line = info.lines - (recordText.match(/\r\n|\r|\n/g)?.length??0);
    const values = Object.fromEntries(headers.map((h, i) => [h, record[i] ?? '']));
    if (record.length !== headers.length) values.__csv_error = `列数が異なります（${record.length}/${headers.length}）`;
    return { values, line, endLine:info.lines };
  });
  if (rows.length > 50000) throw new InputError('1ファイルは50000明細までです');
  return { headers, rows };
}
export function checkMapping(headers: string[], mapping: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof mapping[key] !== 'string' || !headers.includes(mapping[key] as string)) throw new InputError(`列の指定が必要です: ${key}`);
  for (const value of Object.values(mapping)) if (value && (typeof value !== 'string' || !headers.includes(value))) throw new InputError(`存在しない列: ${value}`);
  const chosen = Object.values(mapping).filter(Boolean);
  if (new Set(chosen).size !== chosen.length) throw new InputError('同じ列を複数の項目へ割り当てられません');
}
export interface NormalizedRow {
  bankId: string | null; date: string | null; direction: 'in' | 'out' | null;
  amount: number | null; description: string; name: string; balance: number | null;
  fingerprint: string | null; error: string | null;
}
export function normalizeRow(raw: Record<string, string>, m: CsvMapping, start: string, end: string): NormalizedRow {
  const description = raw[m.description] ?? '';
  const name = (m.counterparty ? raw[m.counterparty] : description) ?? '';
  const out: NormalizedRow = { bankId: m.bankId ? raw[m.bankId]?.trim() || null : null, date: null, direction: null, amount: null, description, name, balance: null, fingerprint: null, error: null };
  try {
    if (raw.__csv_error) throw new InputError(raw.__csv_error);
    out.date = date(raw[m.date]);
    if (out.date < start || out.date > end) throw new InputError('対象期間外です');
    const deposit = yen(raw[m.deposit]), withdrawal = yen(raw[m.withdrawal]);
    if ((deposit ?? 0) > 0 && (withdrawal ?? 0) > 0) throw new InputError('入金と出金が両方あります');
    if ((deposit ?? 0) === 0 && (withdrawal ?? 0) === 0) throw new InputError('0円または入出金が未指定です');
    out.direction = (deposit ?? 0) > 0 ? 'in' : 'out';
    out.amount = out.direction === 'in' ? deposit : withdrawal;
    if (m.currency && raw[m.currency] !== 'JPY') throw new InputError('円建て以外は未対応です');
    out.balance = m.balance ? yen(raw[m.balance], true) : null;
    out.fingerprint = hash(JSON.stringify([out.date, out.direction, out.amount, norm(description), norm(name)]));
  } catch (err) { out.error = err instanceof Error ? err.message : '不正な行です'; }
  return out;
}
export interface Rule {
  id: string; code: string; direction: 'in' | 'out'; descriptionEquals: string;
  amount?: number; debit: string; credit: string; bankAccount: string; tax: string;
  version: string; evidence: string; confirmedBy: string;
}
export interface JobContext {
  company: string; account: string; start: string; end: string;
  evidenceKind: 'synthetic' | 'real'; closeStatus: 'unknown' | 'open' | 'closed';
}
export function validateContext(v: any): JobContext {
  const company = required(v.company, '会社ID'), account = required(v.account, '口座ID');
  const start = date(required(v.start, '開始日')), end = date(required(v.end, '終了日'));
  if (start > end || start.slice(0, 7) !== end.slice(0, 7)) throw new InputError('初期版は同じ月内の期間を指定してください');
  if (!['synthetic', 'real'].includes(v.evidenceKind)) throw new InputError('実データ／模擬データの区分が必要です');
  if (!['unknown', 'open', 'closed'].includes(v.closeStatus)) throw new InputError('締め状態を指定してください');
  return { company, account, start, end, evidenceKind: v.evidenceKind, closeStatus: v.closeStatus };
}
