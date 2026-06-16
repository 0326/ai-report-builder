/** CSV 解析 + 数据集注册中心（真实数据层）。上传走临时 .artifacts/datasets。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, toDatasetId } from '../src/csv.ts';

test('CSV：引号内逗号/换行/转义双引号', () => {
  const csv = 'name,note,amount\n"Acme, Inc.","line1\nline2",1200\n"He said ""hi""",x,3\n';
  const t = parseTable(csv);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].name, 'Acme, Inc.');
  assert.equal(t.rows[0].note, 'line1\nline2');
  assert.equal(t.rows[0].amount, 1200);
  assert.equal(t.rows[1].name, 'He said "hi"');
});

test('CSV：列类型推断（number/date/string）+ 千分位/百分号', () => {
  const csv = 'date,region,sales,rate\n2026-01-01,华东,"1,200",12.5%\n2026-01-02,华北,980,8%\n';
  const t = parseTable(csv);
  const byName = Object.fromEntries(t.columns.map((c) => [c.name, c.type]));
  assert.equal(byName.date, 'date');
  assert.equal(byName.region, 'string');
  assert.equal(byName.sales, 'number');
  assert.equal(byName.rate, 'number');
  assert.equal(t.rows[0].sales, 1200);
  assert.equal(t.rows[0].rate, 12.5);
});

test('CSV：自动探测制表符分隔（TSV）', () => {
  const tsv = 'a\tb\tc\n1\t2\t3\n4\t5\t6\n';
  const t = parseTable(tsv);
  assert.deepEqual(t.columns.map((c) => c.name), ['a', 'b', 'c']);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1].b, 5);
});

test('CSV：空表/单行报错', () => {
  assert.throws(() => parseTable('only,header\n'), /表头/);
});

test('toDatasetId：安全化 + ds_ 前缀', () => {
  assert.equal(toDatasetId('销售数据 2026.csv'), 'ds_销售数据_2026');
  assert.equal(toDatasetId('Sales-Q1.CSV'), 'ds_sales_q1');
  assert.equal(toDatasetId('!!!.csv'), 'ds_data');
});

// 注册中心：用临时目录隔离落盘
test('数据集注册中心：上传 → 列出 → 查询 → 过滤 → 删除', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = mkdtempSync(join(tmpdir(), 'daf-ds-'));
  // 用环境覆盖 store 路径：datasets.ts 用 REPO_ROOT/.artifacts/datasets，这里改用真实路径做集成
  // 直接测纯函数 + 真实落盘到仓库 .artifacts（测试后清理该 id）
  const ds = await import('../src/datasets.ts');
  const csv = 'region,product,sales\n华东,A,100\n华东,B,200\n华北,A,300\n';
  const id = toDatasetId('__test_sales__');
  try {
    const meta = ds.importDataset(csv, { id, title: '测试销售' });
    assert.equal(meta.source, 'upload');
    assert.equal(meta.rowCount, 3);
    assert.ok(meta.filterable.includes('region'));
    assert.ok(meta.fields.find((f) => f.name === 'sales')?.role === 'measure');

    assert.ok(ds.knownDatasetIds().includes(id));
    assert.equal(ds.queryDataset(id, {}).length, 3);
    assert.equal(ds.queryDataset(id, { region: '华东' }).length, 2);
    assert.equal(ds.queryDataset(id, { region: '华北', product: 'A' }).length, 1);

    const doc = ds.datasetDoc();
    assert.match(doc, /用户上传·真实数据/);
    assert.match(doc, new RegExp(id));

    assert.equal(ds.deleteDataset(id), true);
    assert.ok(!ds.knownDatasetIds().includes(id));
  } finally {
    ds.deleteDataset(id);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('内置示例数据集仍可查（region 因子）', async () => {
  const ds = await import('../src/datasets.ts');
  assert.ok(ds.knownDatasetIds().includes('metric_dau'));
  const all = ds.queryDataset('metric_dau', {});
  const app = ds.queryDataset('metric_dau', { region: 'app' });
  assert.equal(all.length, 7);
  assert.ok((app[0].dau as number) < (all[0].dau as number));
});
