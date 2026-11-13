import { createHash } from 'node:crypto';
import type {
  GoogleCell,
  GoogleGridSheet,
  GridSnapshot,
  GridLayout,
} from './grid-layout';

export type EditableCell = {
  row: number;
  column: number;
  sourceRow: number;
  sourceColumn: number;
  value: string;
  valueType?: 'number';
};
export type GridEditState = {
  revision: string;
  cells: EditableCell[];
  readOnlyHash: string;
};

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const gridEditRevision = (
  layout: GridLayout,
  cells: EditableCell[],
  readOnlyHash: string,
) => hash({ layout, cells, readOnlyHash });

/** Preserve numeric cells without interpreting text as formulas or other types. */
export function applyCellEdit(cell: EditableCell, value: string): EditableCell {
  const numeric =
    cell.valueType === 'number' &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) &&
    Number.isFinite(Number(value));
  return {
    ...cell,
    value: numeric ? String(Number(value)) : value,
    valueType: numeric ? 'number' : undefined,
  };
}

/** Formulas, generated values, dates, validation and protected ranges stay read-only. */
export function gridEditState(
  sheet: GoogleGridSheet,
  grid: GridSnapshot,
): GridEditState {
  const cells = new Map<string, GoogleCell & { dataValidation?: unknown }>();
  for (const block of sheet.data ?? [])
    block.rowData?.forEach((row, r) =>
      row.values?.forEach((cell, c) =>
        cells.set(
          `${(block.startRow ?? 0) + r}:${(block.startColumn ?? 0) + c}`,
          cell,
        ),
      ),
    );
  const protectedRanges =
    (
      sheet as GoogleGridSheet & {
        protectedRanges?: Array<{
          range?: {
            startRowIndex?: number;
            endRowIndex?: number;
            startColumnIndex?: number;
            endColumnIndex?: number;
          };
        }>;
      }
    ).protectedRanges ?? [];
  const editable: EditableCell[] = [];
  const readOnly: unknown[] = [];
  const blocked = new Uint8Array(
    grid.gridLayout.rowCount * grid.gridLayout.columnCount,
  );
  for (const merge of grid.gridLayout.merges) {
    for (let row = merge.startRow; row < merge.endRow; row++)
      for (let column = merge.startColumn; column < merge.endColumn; column++) {
        if (
          merge.contentHidden ||
          row !== merge.startRow ||
          column !== merge.startColumn
        )
          blocked[row * grid.gridLayout.columnCount + column] = 1;
      }
  }
  const unknownProtection = protectedRanges.some(
    (protection) => !protection.range,
  );
  grid.gridLayout.rowMap.forEach((sourceRow, row) =>
    grid.gridLayout.columnMap.forEach((sourceColumn, column) => {
      const cell = cells.get(`${sourceRow}:${sourceColumn}`);
      const value = cell?.userEnteredValue;
      const typedOrGenerated =
        value?.formulaValue !== undefined ||
        value?.boolValue !== undefined ||
        cell?.effectiveValue?.boolValue !== undefined ||
        cell?.effectiveValue?.errorValue ||
        cell?.dataValidation ||
        ['DATE', 'TIME', 'DATE_TIME'].includes(
          cell?.effectiveFormat?.numberFormat?.type ?? '',
        ) ||
        ((Boolean(cell?.formattedValue) ||
          cell?.effectiveValue?.numberValue !== undefined ||
          cell?.effectiveValue?.stringValue !== undefined) &&
          value?.stringValue === undefined &&
          value?.numberValue === undefined);
      const protectedCell =
        unknownProtection ||
        protectedRanges.some(
          ({ range }) =>
            range &&
            sourceRow >= (range.startRowIndex ?? 0) &&
            sourceRow < (range.endRowIndex ?? Infinity) &&
            sourceColumn >= (range.startColumnIndex ?? 0) &&
            sourceColumn < (range.endColumnIndex ?? Infinity),
        );
      if (
        typedOrGenerated ||
        protectedCell ||
        blocked[row * grid.gridLayout.columnCount + column]
      ) {
        // Raw formulas stay on the server. The fingerprint also detects row identity/type changes.
        readOnly.push({
          row,
          column,
          value: value ?? cell?.effectiveValue ?? cell?.formattedValue ?? null,
          validation: cell?.dataValidation ?? null,
        });
        return;
      }
      editable.push({
        row,
        column,
        sourceRow,
        sourceColumn,
        value:
          value?.numberValue !== undefined
            ? String(value.numberValue)
            : (value?.stringValue ?? cell?.formattedValue ?? ''),
        ...(value?.numberValue !== undefined
          ? { valueType: 'number' as const }
          : {}),
      });
    }),
  );
  const readOnlyHash = hash(readOnly);
  return {
    revision: gridEditRevision(grid.gridLayout, editable, readOnlyHash),
    cells: editable,
    readOnlyHash,
  };
}
