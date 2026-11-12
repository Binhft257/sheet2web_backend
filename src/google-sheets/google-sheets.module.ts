import { Module } from '@nestjs/common';
import { GoogleSheetsService } from './google-sheets.service';
import { GoogleSheetsRequestExecutor } from './google-sheets-request.executor';

@Module({
  providers: [GoogleSheetsService, GoogleSheetsRequestExecutor],
  exports: [GoogleSheetsService],
})
export class GoogleSheetsModule {}
