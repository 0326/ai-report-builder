/** 表格物料（VTable.ListTable） */
import { useEffect, useRef } from 'react';

type Row = Record<string, unknown>;

export interface DataTableProps {
  data?: Row[];
  columns?: Array<{ field: string; title?: string; width?: number | 'auto' }>;
  onEmit?: (event: string, payload?: unknown) => void;
}

export function DataTable({ data = [], columns, onEmit }: DataTableProps) {
  const domRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<{ setRecords: (r: Row[]) => void; release: () => void } | null>(null);
  const dataJson = JSON.stringify(data);

  useEffect(() => {
    let disposed = false;
    const mount = async () => {
      const VTable = await import('@visactor/vtable');
      if (disposed || !domRef.current) return;
      const rows: Row[] = JSON.parse(dataJson);
      const cols = (columns && columns.length
        ? columns
        : Object.keys(rows[0] ?? {}).map((field) => ({ field }))
      ).map((c) => ({
        field: c.field,
        title: c.title ?? c.field,
        width: typeof c.width === 'number' ? c.width : 'auto',
      }));
      if (!tableRef.current) {
        const table = new VTable.ListTable(domRef.current, {
          records: rows,
          columns: cols as never,
          widthMode: 'adaptive',
          defaultRowHeight: 34,
          defaultHeaderRowHeight: 36,
        });
        tableRef.current = table as unknown as typeof tableRef.current;
        (table as unknown as { on: (evt: string, cb: (args: unknown) => void) => void })
          .on('click_cell', (args) => onEmit?.('rowClick', args));
      } else {
        tableRef.current.setRecords(rows);
      }
    };
    void mount();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataJson]);

  useEffect(() => () => {
    tableRef.current?.release();
    tableRef.current = null;
  }, []);

  return <div ref={domRef} style={{ width: '100%', height: '100%', minHeight: 80 }} />;
}
