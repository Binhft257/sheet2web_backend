export type GridRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export type GridDimension = { sizePx: number };
export type CellLayout = {
  row: number;
  column: number;
  horizontalAlignment: 'LEFT' | 'CENTER' | 'RIGHT';
  verticalAlignment: 'TOP' | 'MIDDLE' | 'BOTTOM';
  wrapStrategy: 'WRAP' | 'CLIP' | 'OVERFLOW_CELL';
};

export type GridLayout = {
  version: 1;
  sheetId: number;
  sourceRange: GridRange;
  rowCount: number;
  columnCount: number;
  rowMap: number[];
  columnMap: number[];
  rowDimensions: GridDimension[];
  columnDimensions: GridDimension[];
  merges: Array<GridRange & { contentHidden: boolean }>;
  cellLayouts: CellLayout[];
  headerRowIndex: 0 | null;
};

export type GridIssue = {
  code:
    | 'HIDDEN_DIMENSIONS_REMOVED'
    | 'CHARTS_UNSUPPORTED'
    | 'IMAGES_UNSUPPORTED'
    | 'IMAGE_DETECTION_INCOMPLETE'
    | 'PREVIEW_TRUNCATED'
    | 'DIMENSION_SIZE_DEFAULTED';
};

export type GridSnapshot = {
  headers: string[];
  rows: string[][];
  rowCount: number;
  gridLayout: GridLayout;
  issues: GridIssue[];
  truncated: boolean;
};

export type GoogleCell = {
  formattedValue?: string;
  effectiveValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
    errorValue?: { type?: string };
  };
  userEnteredValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
    formulaValue?: string;
  };
  effectiveFormat?: {
    horizontalAlignment?: CellLayout['horizontalAlignment'];
    verticalAlignment?: CellLayout['verticalAlignment'];
    wrapStrategy?: CellLayout['wrapStrategy'];
  };
};

export type GoogleDimension = {
  pixelSize?: number;
  hiddenByUser?: boolean;
  hiddenByFilter?: boolean;
};

export type GoogleGridSheet = {
  properties?: {
    sheetId?: number;
    title?: string;
    hidden?: boolean;
    sheetType?: string;
    gridProperties?: { rowCount?: number; columnCount?: number };
  };
  data?: Array<{
    startRow?: number;
    startColumn?: number;
    rowData?: Array<{ values?: GoogleCell[] }>;
    rowMetadata?: GoogleDimension[];
    columnMetadata?: GoogleDimension[];
  }>;
  merges?: Array<{
    startRowIndex?: number;
    endRowIndex?: number;
    startColumnIndex?: number;
    endColumnIndex?: number;
  }>;
  charts?: Array<{ chartId?: number }>;
};

export const GRID_LIMITS = {
  maxRows: 2000,
  maxColumns: 100,
  maxCells: 100_000,
  maxBytes: 2 * 1024 * 1024,
  maxResponseBytes: 8 * 1024 * 1024,
  previewRows: 100,
} as const;

export type GridLimits = {
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxBytes: number;
};
