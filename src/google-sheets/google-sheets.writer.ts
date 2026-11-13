import { Injectable } from '@nestjs/common';
import {
  GoogleConnectionsService,
  type GoogleAccess,
} from '../modules/google-connections/google-connections.service';
import { GoogleSheetsRequestExecutor } from './google-sheets-request.executor';

export type SourceTextWrite = {
  sheetId: number;
  row: number;
  column: number;
  value: string | number;
};

@Injectable()
export class GoogleSheetsWriter {
  constructor(
    private readonly connections: GoogleConnectionsService,
    private readonly requests: GoogleSheetsRequestExecutor,
  ) {}
  async write(
    access: GoogleAccess,
    spreadsheetId: string,
    cells: SourceTextWrite[],
  ) {
    const client = await this.connections.client(access);
    // Explicit values preserve numbers and prevent text beginning with '=' becoming formulas.
    await this.requests.runWrite(() =>
      client.spreadsheets.batchUpdate(
        {
          spreadsheetId,
          requestBody: {
            requests: cells.map((cell) => ({
              updateCells: {
                start: {
                  sheetId: cell.sheetId,
                  rowIndex: cell.row,
                  columnIndex: cell.column,
                },
                rows: [
                  {
                    values: [
                      {
                        userEnteredValue:
                          typeof cell.value === 'number'
                            ? { numberValue: cell.value }
                            : { stringValue: cell.value },
                      },
                    ],
                  },
                ],
                fields: 'userEnteredValue',
              },
            })),
          },
        },
        { timeout: 10000, retry: false },
      ),
    );
  }
}
