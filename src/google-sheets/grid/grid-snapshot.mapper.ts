import { BadRequestException } from '@nestjs/common';
import {
  GRID_LIMITS,
  type CellLayout,
  type GoogleCell,
  type GoogleDimension,
  type GoogleGridSheet,
  type GridIssue,
  type GridLimits,
  type GridRange,
  type GridSnapshot,
} from './grid-layout';
import { assertGridBudget } from './grid-range';

const hidden = (dimension?: GoogleDimension) =>
  Boolean(dimension?.hiddenByUser || dimension?.hiddenByFilter);
const intersects = (a: GridRange, b: GridRange) =>
  a.startRow < b.endRow &&
  a.endRow > b.startRow &&
  a.startColumn < b.endColumn &&
  a.endColumn > b.startColumn;
const contains = (outer: GridRange, inner: GridRange) =>
  outer.startRow <= inner.startRow &&
  outer.endRow >= inner.endRow &&
  outer.startColumn <= inner.startColumn &&
  outer.endColumn >= inner.endColumn;

type GridIndex = {
  cells: Map<string, GoogleCell>;
  rowDimensions: Map<number, GoogleDimension>;
  columnDimensions: Map<number, GoogleDimension>;
};

export class GridSnapshotMapper {
  map(
    sheet: GoogleGridSheet,
    selectedRange: GridRange,
    options: {
      fullSheet: boolean;
      useFirstRowAsHeader: boolean;
      previewRows?: number;
      limits?: GridLimits;
    },
  ): GridSnapshot {
    const limits = options.limits ?? GRID_LIMITS;
    assertGridBudget(selectedRange, limits);
    const sheetId = sheet.properties?.sheetId;
    if (!Number.isSafeInteger(sheetId) || sheetId! < 0)
      throw new BadRequestException('Thiếu định danh sheet hợp lệ.');
    if (sheet.properties?.hidden)
      throw new BadRequestException('Không xuất bản tab đang bị ẩn.');
    if (sheet.properties?.sheetType && sheet.properties.sheetType !== 'GRID')
      throw new BadRequestException('Loại sheet này chưa hỗ trợ grid.');

    const index = this.indexCells(sheet, selectedRange);
    const { cells, rowDimensions, columnDimensions } = index;

    const selectedMerges = this.selectMerges(sheet, selectedRange, limits);
    let range = { ...selectedRange };
    if (options.fullSheet) range = this.usedRange(range, index, selectedMerges);
    const indices = (
      start: number,
      end: number,
      dimensions: Map<number, GoogleDimension>,
    ) =>
      Array.from({ length: end - start }, (_, index) => start + index).filter(
        (index) => !hidden(dimensions.get(index)),
      );
    let rowMap = indices(range.startRow, range.endRow, rowDimensions);
    const columnMap = indices(
      range.startColumn,
      range.endColumn,
      columnDimensions,
    );
    const issues: GridIssue[] = [{ code: 'IMAGE_DETECTION_INCOMPLETE' }];
    if (
      rowMap.length !== range.endRow - range.startRow ||
      columnMap.length !== range.endColumn - range.startColumn
    )
      issues.push({ code: 'HIDDEN_DIMENSIONS_REMOVED' });
    let truncated = false;
    if (options.previewRows !== undefined) {
      const maximum =
        options.previewRows +
        (options.useFirstRowAsHeader && rowMap[0] === range.startRow ? 1 : 0);
      if (rowMap.length > maximum) {
        truncated = true;
        let cutoff = rowMap[maximum];
        // Shrink repeatedly because a merge can start inside an earlier merge's rows.
        let previous: number;
        do {
          previous = cutoff;
          for (const merge of selectedMerges)
            if (merge.startRow < cutoff && merge.endRow > cutoff)
              cutoff = Math.max(range.startRow, merge.startRow);
        } while (previous !== cutoff);
        rowMap = rowMap.filter((row) => row < cutoff);
        range = { ...range, endRow: cutoff };
        issues.push({ code: 'PREVIEW_TRUNCATED' });
      }
    }

    const matrix = rowMap.map((row) =>
      columnMap.map((column) =>
        this.displayValue(cells.get(`${row}:${column}`)),
      ),
    );
    const displayMerges = this.displayMerges(
      matrix,
      rowMap,
      columnMap,
      selectedMerges,
      range,
      index,
    );
    const cellLayouts: CellLayout[] = [];
    let imageFormula = false;
    rowMap.forEach((row, r) =>
      columnMap.forEach((column, c) => {
        const cell = cells.get(`${row}:${column}`);
        if (/\bIMAGE\s*\(/i.test(cell?.userEnteredValue?.formulaValue ?? ''))
          imageFormula = true;
        const format = cell?.effectiveFormat;
        if (
          !matrix[r][c] &&
          !format?.horizontalAlignment &&
          !format?.verticalAlignment &&
          !format?.wrapStrategy
        )
          return;
        const value = cell?.effectiveValue;
        const horizontal =
          format?.horizontalAlignment ??
          (value?.numberValue !== undefined
            ? 'RIGHT'
            : value?.boolValue !== undefined
              ? 'CENTER'
              : 'LEFT');
        const layout: CellLayout = {
          row: r,
          column: c,
          horizontalAlignment: horizontal,
          verticalAlignment: format?.verticalAlignment ?? 'BOTTOM',
          wrapStrategy: format?.wrapStrategy ?? 'OVERFLOW_CELL',
        };
        if (
          layout.horizontalAlignment !== 'LEFT' ||
          layout.verticalAlignment !== 'BOTTOM' ||
          layout.wrapStrategy !== 'OVERFLOW_CELL'
        )
          cellLayouts.push(layout);
      }),
    );
    if (imageFormula) issues.push({ code: 'IMAGES_UNSUPPORTED' });
    if (sheet.charts?.length) issues.push({ code: 'CHARTS_UNSUPPORTED' });
    let defaulted = false;
    const dimensions = (
      map: number[],
      source: Map<number, GoogleDimension>,
      fallback: number,
    ) =>
      map.map((index) => {
        const size = source.get(index)?.pixelSize;
        if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0)
          defaulted = true;
        return {
          sizePx:
            typeof size === 'number' && Number.isFinite(size) && size > 0
              ? size
              : fallback,
        };
      });
    const headerRowIndex =
      options.useFirstRowAsHeader && rowMap[0] === selectedRange.startRow
        ? 0
        : null;
    const gridLayout: GridSnapshot['gridLayout'] = {
      version: 1,
      sheetId: sheetId!,
      sourceRange: range,
      rowCount: rowMap.length,
      columnCount: columnMap.length,
      rowMap,
      columnMap,
      rowDimensions: dimensions(rowMap, rowDimensions, 21),
      columnDimensions: dimensions(columnMap, columnDimensions, 100),
      merges: displayMerges,
      cellLayouts,
      headerRowIndex,
    };
    if (defaulted) issues.push({ code: 'DIMENSION_SIZE_DEFAULTED' });
    const headers =
      headerRowIndex === 0
        ? (matrix[0] ?? [])
        : columnMap.map((_, index) => `Column ${index + 1}`);
    const rows = headerRowIndex === 0 ? matrix.slice(1) : matrix;
    const snapshot: GridSnapshot = {
      headers,
      rows,
      rowCount: rows.length,
      gridLayout,
      issues,
      truncated,
    };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > limits.maxBytes)
      throw new BadRequestException(
        'Dữ liệu xuất bản vượt giới hạn dung lượng. Vui lòng chọn range nhỏ hơn.',
      );
    return snapshot;
  }

  private indexCells(
    sheet: GoogleGridSheet,
    selectedRange: GridRange,
  ): GridIndex {
    const cells = new Map<string, GoogleCell>();
    const rowDimensions = new Map<number, GoogleDimension>();
    const columnDimensions = new Map<number, GoogleDimension>();
    for (const block of sheet.data ?? []) {
      const startRow = block.startRow ?? 0;
      const startColumn = block.startColumn ?? 0;
      block.rowMetadata?.forEach((value, index) =>
        rowDimensions.set(startRow + index, value),
      );
      block.columnMetadata?.forEach((value, index) =>
        columnDimensions.set(startColumn + index, value),
      );
      block.rowData?.forEach((row, r) =>
        row.values?.forEach((cell, c) => {
          const rowIndex = startRow + r,
            columnIndex = startColumn + c;
          if (
            rowIndex >= selectedRange.startRow &&
            rowIndex < selectedRange.endRow &&
            columnIndex >= selectedRange.startColumn &&
            columnIndex < selectedRange.endColumn
          )
            cells.set(`${rowIndex}:${columnIndex}`, cell);
        }),
      );
    }

    return { cells, rowDimensions, columnDimensions };
  }

  private selectMerges(
    sheet: GoogleGridSheet,
    selectedRange: GridRange,
    limits: GridLimits,
  ): GridRange[] {
    const merges = (sheet.merges ?? []).map(
      (merge): GridRange => ({
        startRow: merge.startRowIndex ?? 0,
        endRow: merge.endRowIndex ?? NaN,
        startColumn: merge.startColumnIndex ?? 0,
        endColumn: merge.endColumnIndex ?? NaN,
      }),
    );
    for (const merge of merges) {
      assertGridBudget(merge, {
        ...limits,
        maxRows: Number.MAX_SAFE_INTEGER,
        maxColumns: Number.MAX_SAFE_INTEGER,
        maxCells: Number.MAX_SAFE_INTEGER,
      });
      if (!intersects(selectedRange, merge)) continue;
      if (intersects(selectedRange, merge) && !contains(selectedRange, merge))
        throw new BadRequestException(
          'Range cắt qua ô gộp. Vui lòng chọn trọn vùng ô gộp.',
        );
    }
    const selectedMerges = merges
      .filter((merge) => contains(selectedRange, merge))
      .sort(
        (a, b) =>
          a.startRow - b.startRow ||
          a.startColumn - b.startColumn ||
          a.endRow - b.endRow ||
          a.endColumn - b.endColumn,
      );
    return selectedMerges;
  }

  private usedRange(
    range: GridRange,
    index: GridIndex,
    selectedMerges: GridRange[],
  ): GridRange {
    const { cells, rowDimensions, columnDimensions } = index;
    let endRow = range.startRow,
      endColumn = range.startColumn;
    for (const [key, cell] of cells) {
      const [row, column] = key.split(':').map(Number);
      if (
        !hidden(rowDimensions.get(row)) &&
        !hidden(columnDimensions.get(column)) &&
        this.hasContent(cell)
      ) {
        endRow = Math.max(endRow, row + 1);
        endColumn = Math.max(endColumn, column + 1);
      }
    }
    for (const merge of selectedMerges) {
      endRow = Math.max(endRow, merge.endRow);
      endColumn = Math.max(endColumn, merge.endColumn);
    }
    // Resizing/formatting alone never extends a full sheet's used area.
    // Dimensions within the content/merge bounds are still preserved by map().
    range = { ...range, endRow, endColumn };
    return range;
  }

  private displayMerges(
    matrix: string[][],
    rowMap: number[],
    columnMap: number[],
    selectedMerges: GridRange[],
    range: GridRange,
    index: GridIndex,
  ): GridSnapshot['gridLayout']['merges'] {
    const { rowDimensions, columnDimensions } = index;
    const displayMerges: GridSnapshot['gridLayout']['merges'] = [];
    const occupied = new Set<string>();
    for (const merge of selectedMerges.filter((value) =>
      contains(range, value),
    )) {
      const rows = rowMap.flatMap((row, index) =>
        row >= merge.startRow && row < merge.endRow ? [index] : [],
      );
      const columns = columnMap.flatMap((column, index) =>
        column >= merge.startColumn && column < merge.endColumn ? [index] : [],
      );
      if (!rows.length || !columns.length) continue;
      const contentHidden =
        hidden(rowDimensions.get(merge.startRow)) ||
        hidden(columnDimensions.get(merge.startColumn));
      for (const row of rows)
        for (const column of columns) {
          const key = `${row}:${column}`;
          if (occupied.has(key))
            throw new BadRequestException('Các vùng ô gộp bị chồng lấn.');
          occupied.add(key);
          if (contentHidden || row !== rows[0] || column !== columns[0])
            matrix[row][column] = '';
        }
      displayMerges.push({
        startRow: rows[0],
        endRow: rows.at(-1)! + 1,
        startColumn: columns[0],
        endColumn: columns.at(-1)! + 1,
        contentHidden,
      });
    }
    return displayMerges;
  }

  private hasContent(cell: GoogleCell): boolean {
    return (
      this.displayValue(cell) !== '' ||
      Object.values(cell.userEnteredValue ?? {}).some(
        (value) => value !== undefined && value !== '',
      )
    );
  }

  private displayValue(cell?: GoogleCell): string {
    if (cell?.formattedValue !== undefined) return cell.formattedValue;
    const value = cell?.effectiveValue;
    if (value?.errorValue) return `#${value.errorValue.type ?? 'ERROR'}!`;
    return String(
      value?.stringValue ?? value?.numberValue ?? value?.boolValue ?? '',
    );
  }
}
