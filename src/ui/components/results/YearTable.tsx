/**
 * Scrollable, lightly-virtualized year-by-year breakdown table.
 * Rows where IRMAA is non-zero get a red left border; the row where RMDs
 * begin gets a yellow marker. Virtualizes (windowed render) once the trace
 * exceeds VIRTUALIZE_THRESHOLD rows.
 */

import { useState, type UIEvent } from 'react';
import { rmdStartAge } from '../../../engine/tables/index.ts';
import type { YearRecord } from '../../../engine/types.ts';

interface YearTableProps {
  readonly trace: readonly YearRecord[];
  readonly birthYear: number;
}

const COLUMNS: ReadonlyArray<{ key: keyof YearRecord; label: string }> = [
  { key: 'age', label: 'Age' },
  { key: 'year', label: 'Year' },
  { key: 'conversionAmount', label: 'Conversion' },
  { key: 'ordinaryIncome', label: 'Ordinary income' },
  { key: 'magi', label: 'MAGI' },
  { key: 'federalIncomeTax', label: 'Fed tax' },
  { key: 'irmaa', label: 'IRMAA' },
  { key: 'niit', label: 'NIIT' },
  { key: 'waCapGainsTax', label: 'WA CGT' },
  { key: 'yearCost', label: 'Year cost' },
  { key: 'traditionalBalance', label: 'Trad balance' },
  { key: 'rothBalance', label: 'Roth balance' },
];

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const ROW_HEIGHT_PX = 32;
const CONTAINER_HEIGHT_PX = 400;
const VIRTUALIZE_THRESHOLD = 50;
const RENDER_BUFFER_ROWS = 5;

function formatCell(record: YearRecord, key: keyof YearRecord): string {
  const value = record[key];
  return typeof value === 'number' && key !== 'age' && key !== 'year'
    ? NUMBER_FORMATTER.format(value)
    : String(value);
}

export function YearTable({ trace, birthYear }: YearTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const rmdAge = rmdStartAge(birthYear);
  const virtualized = trace.length > VIRTUALIZE_THRESHOLD;

  const visibleRows = virtualized ? Math.ceil(CONTAINER_HEIGHT_PX / ROW_HEIGHT_PX) + RENDER_BUFFER_ROWS : trace.length;
  const startIndex = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - RENDER_BUFFER_ROWS) : 0;
  const endIndex = Math.min(trace.length, startIndex + visibleRows);
  const rows = trace.slice(startIndex, endIndex);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop);

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="mb-2 text-sm text-text-muted">Year-by-year breakdown</div>
      <div
        className="overflow-y-auto"
        style={{ height: virtualized ? CONTAINER_HEIGHT_PX : undefined, maxHeight: CONTAINER_HEIGHT_PX }}
        onScroll={virtualized ? handleScroll : undefined}
        data-testid="year-table-scroll"
      >
        <table className="w-full border-collapse text-right font-mono text-xs">
          <thead className="sticky top-0 bg-surface text-text-muted">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} className="px-2 py-1 text-right font-sans font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {virtualized && startIndex > 0 && (
              <tr style={{ height: startIndex * ROW_HEIGHT_PX }} aria-hidden="true">
                <td colSpan={COLUMNS.length} />
              </tr>
            )}
            {rows.map((record) => {
              const hasIrmaa = record.irmaa > 0;
              const isRmdYear = record.age === rmdAge;
              const classNames = [
                'border-l-2',
                hasIrmaa ? 'border-warning' : 'border-transparent',
                isRmdYear ? 'bg-accent/10' : '',
              ].join(' ');
              return (
                <tr
                  key={record.year}
                  className={classNames}
                  style={{ height: ROW_HEIGHT_PX }}
                  aria-label={hasIrmaa ? 'IRMAA year' : isRmdYear ? 'RMD start year' : undefined}
                >
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-2 py-1 text-text">
                      {formatCell(record, column.key)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {virtualized && endIndex < trace.length && (
              <tr style={{ height: (trace.length - endIndex) * ROW_HEIGHT_PX }} aria-hidden="true">
                <td colSpan={COLUMNS.length} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
