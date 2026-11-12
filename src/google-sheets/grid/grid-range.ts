import { BadRequestException } from '@nestjs/common';
import { GRID_LIMITS, type GridLimits, type GridRange } from './grid-layout';

function columnIndex(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }
  return value - 1;
}

export function gridRangeA1(range: GridRange): string {
  const letters = (index: number) => {
    let value = index + 1;
    let result = '';
    while (value > 0) {
      value--;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  };
  return `${letters(range.startColumn)}${range.startRow + 1}:${letters(range.endColumn - 1)}${range.endRow}`;
}

export function assertGridBudget(
  range: GridRange,
  limits: GridLimits = GRID_LIMITS,
) {
  const rows = range.endRow - range.startRow;
  const columns = range.endColumn - range.startColumn;
  if (
    !Object.values(range).every(Number.isSafeInteger) ||
    range.startRow < 0 ||
    range.startColumn < 0 ||
    rows < 1 ||
    columns < 1
  )
    throw new BadRequestException('Phạm vi ô không hợp lệ.');
  if (
    rows > limits.maxRows ||
    columns > limits.maxColumns ||
    rows * columns > limits.maxCells
  ) {
    throw new BadRequestException(
      'Vùng dữ liệu quá lớn. Vui lòng chọn một range nhỏ hơn.',
    );
  }
}

export function resolveGridRange(
  notation: string | undefined,
  rowCount: number,
  columnCount: number,
  limits: GridLimits = GRID_LIMITS,
): GridRange {
  let range: GridRange = {
    startRow: 0,
    endRow: rowCount,
    startColumn: 0,
    endColumn: columnCount,
  };
  const text = notation?.trim().toUpperCase();
  if (text) {
    const cells = /^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/.exec(text);
    const columns = /^([A-Z]+):([A-Z]+)$/.exec(text);
    const rows = /^([1-9]\d*):([1-9]\d*)$/.exec(text);
    if (cells)
      range = {
        startRow: Number(cells[2]) - 1,
        endRow: Number(cells[4] ?? cells[2]),
        startColumn: columnIndex(cells[1]),
        endColumn: columnIndex(cells[3] ?? cells[1]) + 1,
      };
    else if (columns)
      range = {
        ...range,
        startColumn: columnIndex(columns[1]),
        endColumn: columnIndex(columns[2]) + 1,
      };
    else if (rows)
      range = {
        ...range,
        startRow: Number(rows[1]) - 1,
        endRow: Number(rows[2]),
      };
    else
      throw new BadRequestException(
        'Range A1 không hợp lệ; không truyền tên sheet trong range.',
      );
  }
  assertGridBudget(range, limits);
  if (range.endRow > rowCount || range.endColumn > columnCount) {
    throw new BadRequestException('Range vượt kích thước sheet hiện tại.');
  }
  return range;
}
