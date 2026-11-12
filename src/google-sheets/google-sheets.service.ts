import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { sheets_v4 } from 'googleapis';
import { GoogleSheetsMetadata } from './types/google-sheets-metadata.type';
import { GoogleSheetsRequestExecutor } from './google-sheets-request.executor';
import {
  GRID_LIMITS,
  type GoogleGridSheet,
  type GridSnapshot,
} from './grid/grid-layout';
import { gridRangeA1, resolveGridRange } from './grid/grid-range';
import { GridSnapshotMapper } from './grid/grid-snapshot.mapper';
import { buildA1Range } from '../modules/data-sources/utils/sheet-range.util';

const GRID_FIELDS = [
  'sheets(properties(sheetId,title,hidden,sheetType,gridProperties(rowCount,columnCount)),merges,charts(chartId),',
  'data(startRow,startColumn,rowMetadata(pixelSize,hiddenByUser,hiddenByFilter),columnMetadata(pixelSize,hiddenByUser,hiddenByFilter),',
  'rowData(values(formattedValue,effectiveValue(numberValue,boolValue,errorValue(type)),userEnteredValue(formulaValue),',
  'effectiveFormat(horizontalAlignment,verticalAlignment,wrapStrategy)))))',
].join('');
const REQUEST_OPTIONS = {
  timeout: 10_000,
  retry: false,
  maxContentLength: GRID_LIMITS.maxResponseBytes,
};

type GoogleSheetProperties = {
  title?: string;
  locale?: string;
  timeZone?: string;
};

type GoogleSheetGridProperties = {
  rowCount?: number;
  columnCount?: number;
};

type GoogleSheetTabProperties = {
  title?: string;
  sheetId?: number;
  index?: number;
  hidden?: boolean;
  sheetType?: string;
  gridProperties?: GoogleSheetGridProperties;
};

@Injectable()
export class GoogleSheetsService {
  private readonly mapper = new GridSnapshotMapper();

  constructor(
    private readonly configService: ConfigService,
    private readonly requests: GoogleSheetsRequestExecutor,
  ) {}

  async getGridSnapshot(input: {
    spreadsheetId: string;
    googleSheetId?: number | null;
    sheetName: string;
    rangeA1Notation?: string;
    useFirstRowAsHeader: boolean;
    previewRows?: number;
  }): Promise<GridSnapshot & { sheetName: string }> {
    // Lightweight preflight prevents an unbounded grid download and resolves renamed tabs by ID.
    // This only reads metadata; deletion is exclusively the owner's explicit tab-sync operation.
    const metadata = await this.getSpreadsheetMetadata(input.spreadsheetId);
    const tab = metadata.sheets.find((sheet) =>
      input.googleSheetId != null
        ? sheet.googleSheetId === input.googleSheetId
        : sheet.sheetName === input.sheetName,
    );
    if (!tab)
      throw new BadRequestException(
        'Không tìm thấy tab nguồn. Hãy đồng bộ lại danh sách tab.',
      );
    if (tab.isHidden)
      throw new BadRequestException('Không xuất bản tab đang bị ẩn.');
    const rows = Number(tab.metadataJson.rowCount);
    const columns = Number(tab.metadataJson.columnCount);
    const range = resolveGridRange(input.rangeA1Notation, rows, columns);
    const apiKey = this.configService.get<string>('GOOGLE_SHEETS_API_KEY');
    if (!apiKey)
      throw new InternalServerErrorException('Thiếu GOOGLE_SHEETS_API_KEY');
    const client = this.createSheetsClient(apiKey);
    const response = await this.requests.run(() =>
      client.spreadsheets.get(
        {
          spreadsheetId: input.spreadsheetId,
          ranges: [buildA1Range(tab.sheetName, gridRangeA1(range))],
          fields: GRID_FIELDS,
        },
        REQUEST_OPTIONS,
      ),
    );
    const sheet = (
      response as { data?: { sheets?: GoogleGridSheet[] } }
    ).data?.sheets?.find(
      (value) => value.properties?.sheetId === tab.googleSheetId,
    );
    if (!sheet)
      throw new ConflictException(
        'Cấu trúc sheet đã thay đổi trong lúc đọc. Vui lòng thử lại.',
      );
    const current = sheet.properties?.gridProperties;
    if (
      !current ||
      range.endRow > (current.rowCount ?? 0) ||
      range.endColumn > (current.columnCount ?? 0) ||
      (!input.rangeA1Notation &&
        (current.rowCount !== rows || current.columnCount !== columns))
    ) {
      throw new ConflictException(
        'Kích thước sheet đã thay đổi trong lúc đọc. Vui lòng thử lại.',
      );
    }
    const verifiedRows = new Set<number>();
    const verifiedColumns = new Set<number>();
    for (const block of sheet.data ?? []) {
      block.rowMetadata?.forEach((_value, index) =>
        verifiedRows.add((block.startRow ?? 0) + index),
      );
      block.columnMetadata?.forEach((_value, index) =>
        verifiedColumns.add((block.startColumn ?? 0) + index),
      );
    }
    for (let row = range.startRow; row < range.endRow; row++) {
      if (!verifiedRows.has(row))
        throw new ServiceUnavailableException(
          'Chưa đủ metadata để kiểm tra hàng bị ẩn. Không xuất bản dữ liệu.',
        );
    }
    for (let column = range.startColumn; column < range.endColumn; column++) {
      if (!verifiedColumns.has(column))
        throw new ServiceUnavailableException(
          'Chưa đủ metadata để kiểm tra cột bị ẩn. Không xuất bản dữ liệu.',
        );
    }
    return {
      ...this.mapper.map(sheet, range, {
        fullSheet: !input.rangeA1Notation,
        useFirstRowAsHeader: input.useFirstRowAsHeader,
        previewRows: input.previewRows,
      }),
      sheetName: sheet.properties?.title ?? tab.sheetName,
    };
  }

  async getSpreadsheetMetadata(
    spreadsheetId: string,
  ): Promise<GoogleSheetsMetadata> {
    const apiKey = this.configService.get<string>('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('Thiếu GOOGLE_SHEETS_API_KEY');
    }

    const sheets = this.createSheetsClient(apiKey);

    try {
      const response = await this.requests.run(() =>
        sheets.spreadsheets.get(
          {
            spreadsheetId,
            fields:
              'properties.title,properties.locale,properties.timeZone,sheets.properties',
          },
          REQUEST_OPTIONS,
        ),
      );

      const properties = (response.data?.properties ??
        {}) as GoogleSheetProperties;
      const rawSheets = (response.data?.sheets ?? []) as Array<{
        properties?: GoogleSheetTabProperties;
      }>;

      if (
        !rawSheets.length ||
        rawSheets.some(
          (sheet) =>
            !Number.isSafeInteger(sheet.properties?.sheetId) ||
            sheet.properties!.sheetId! < 0 ||
            typeof sheet.properties?.title !== 'string',
        ) ||
        new Set(rawSheets.map((sheet) => sheet.properties!.sheetId)).size !==
          rawSheets.length
      ) {
        throw new ServiceUnavailableException(
          'Metadata Google Sheets chưa đầy đủ. Không thể xác nhận danh sách tab.',
        );
      }

      const mappedSheets = rawSheets.map((sheet, index) => {
        const sheetProperties = sheet.properties ?? {};
        const gridProperties = sheetProperties.gridProperties ?? {};

        const metadataJson: Record<string, unknown> = {};
        if (typeof gridProperties.rowCount === 'number') {
          metadataJson.rowCount = gridProperties.rowCount;
        }
        if (typeof gridProperties.columnCount === 'number') {
          metadataJson.columnCount = gridProperties.columnCount;
        }
        if (typeof sheetProperties.sheetType === 'string') {
          metadataJson.gridType = sheetProperties.sheetType;
        }

        const googleSheetId = sheetProperties.sheetId!;

        return {
          sheetName: sheetProperties.title ?? `Sheet ${index + 1}`,
          googleSheetId,
          gid: String(googleSheetId),
          sortOrder:
            typeof sheetProperties.index === 'number'
              ? sheetProperties.index
              : index,
          isHidden: Boolean(sheetProperties.hidden),
          metadataJson,
        };
      });

      return {
        spreadsheetTitle: properties.title ?? '',
        locale: properties.locale,
        timeZone: properties.timeZone,
        sheets: mappedSheets,
      };
    } catch (error) {
      this.handleMetadataError(error);
    }
  }

  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const apiKey = this.configService.get<string>('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('Thiếu GOOGLE_SHEETS_API_KEY');
    }

    const sheets = this.createSheetsClient(apiKey);

    try {
      const response = await this.requests.run(() =>
        sheets.spreadsheets.values.get(
          {
            spreadsheetId,
            range,
          },
          REQUEST_OPTIONS,
        ),
      );

      const rawValues: unknown = response.data?.values;
      if (!Array.isArray(rawValues)) {
        return [];
      }

      return rawValues.map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
      );
    } catch (error) {
      this.handleValuesError(error);
    }
  }

  private createSheetsClient(apiKey: string): sheets_v4.Sheets {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { google } = require('googleapis') as {
        google: {
          sheets(options: { version: 'v4'; auth: string }): sheets_v4.Sheets;
        };
      };
      return google.sheets({ version: 'v4', auth: apiKey });
    } catch {
      throw new InternalServerErrorException(
        'Thiếu package googleapis. Hãy cài: npm install googleapis',
      );
    }
  }

  private handleMetadataError(error: unknown): never {
    this.handleGoogleSheetsError(
      error,
      'Không đọc được Google Sheet. Hãy kiểm tra link share public.',
    );
  }

  private handleValuesError(error: unknown): never {
    this.handleGoogleSheetsError(
      error,
      'Không đọc được Google Sheet. Hãy kiểm tra quyền chia sẻ hoặc range.',
    );
  }

  private handleGoogleSheetsError(
    error: unknown,
    badRequestMessage: string,
  ): never {
    if (error instanceof HttpException) throw error;
    const statusCode = this.getGoogleErrorStatusCode(error);

    if (statusCode === 400 || statusCode === 403 || statusCode === 404) {
      throw new BadRequestException(badRequestMessage);
    }

    throw new ServiceUnavailableException(
      'Google Sheets API tạm thời không khả dụng. Vui lòng thử lại sau.',
    );
  }

  private getGoogleErrorStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const status = (error as { code?: unknown }).code;
    if (typeof status === 'number') {
      return status;
    }

    const responseStatus = (error as { response?: { status?: unknown } })
      .response?.status;
    if (typeof responseStatus === 'number') {
      return responseStatus;
    }

    return undefined;
  }
}
