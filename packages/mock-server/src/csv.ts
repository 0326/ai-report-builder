/**
 * 零依赖 CSV/TSV 解析 + 列类型推断（真实数据导入用，非 mock）。
 * 正确处理：引号包裹字段、字段内逗号/换行、转义双引号（""）、自动分隔符探测、BOM。
 */

export type ColumnType = 'number' | 'date' | 'string';

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  /** 样本里非空值的去重数（用于判断维度/度量） */
  distinct: number;
}

export interface ParsedTable {
  columns: ColumnMeta[];
  rows: Array<Record<string, unknown>>;
}

/** 探测分隔符：在前若干行里比较 , \t ; 的出现一致性。 */
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4096).split(/\r?\n/).slice(0, 5);
  const candidates = [',', '\t', ';'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    // 一致性：各行分隔符数量越接近越好
    const max = Math.max(...counts);
    const min = Math.min(...counts.filter((c) => c > 0));
    const score = total + (max === min ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** 状态机解析为二维字符串数组（支持引号内分隔符/换行）。 */
function parseRows(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    out.push(row);
    row = [];
  };
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // 末尾残留
  if (field.length > 0 || row.length > 0) pushRow();
  return out;
}

const DATE_RE = /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$|^\d{4}年/;

function inferType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== '' && v != null);
  if (nonEmpty.length === 0) return 'string';
  const numeric = nonEmpty.every((v) => /^-?[\d,]+\.?\d*%?$/.test(v.trim()) && /\d/.test(v));
  if (numeric) return 'number';
  const dates = nonEmpty.filter((v) => DATE_RE.test(v.trim())).length;
  if (dates / nonEmpty.length > 0.8) return 'date';
  return 'string';
}

function coerce(value: string, type: ColumnType): unknown {
  if (value === '') return type === 'number' ? null : '';
  if (type === 'number') {
    const num = Number(value.replace(/,/g, '').replace(/%$/, ''));
    return Number.isFinite(num) ? num : value;
  }
  return value;
}

/** 解析 CSV/TSV 文本为带类型的表（首行为表头）。空表抛错。 */
export function parseTable(raw: string, delimiterHint?: string): ParsedTable {
  const text = raw.replace(/^﻿/, '');
  const delim = delimiterHint ?? detectDelimiter(text);
  const matrix = parseRows(text, delim).filter((r) => r.some((c) => c.trim() !== ''));
  if (matrix.length < 2) throw new Error('CSV 至少需要表头行 + 一行数据');

  const header = matrix[0].map((h, i) => h.trim() || `col_${i + 1}`);
  const dataRows = matrix.slice(1);

  const columns: ColumnMeta[] = header.map((name, ci) => {
    const colValues = dataRows.map((r) => (r[ci] ?? '').trim());
    const type = inferType(colValues);
    const distinct = new Set(colValues.filter((v) => v !== '')).size;
    return { name, type, distinct };
  });

  const rows = dataRows.map((r) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, ci) => {
      obj[col.name] = coerce((r[ci] ?? '').trim(), col.type);
    });
    return obj;
  });

  return { columns, rows };
}

/** 安全 datasetId：从文件名/标题派生（小写、下划线、ds_ 前缀）。 */
export function toDatasetId(name: string): string {
  const slug = name
    .replace(/\.[a-z]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `ds_${slug || 'data'}`;
}
