import { GoogleSheetsWriter } from './google-sheets.writer';
import { SourceOperationLock } from './source-operation-lock';
import { GoogleConnectionsModule } from '../modules/google-connections/google-connections.module';
import { Module } from '@nestjs/common';
import { GoogleSheetsService } from './google-sheets.service';
import { GoogleSheetsRequestExecutor } from './google-sheets-request.executor';

@Module({
  imports: [GoogleConnectionsModule],
  providers: [
    GoogleSheetsService,
    GoogleSheetsRequestExecutor,
    GoogleSheetsWriter,
    SourceOperationLock,
  ],
  exports: [
    GoogleSheetsService,
    GoogleSheetsRequestExecutor,
    GoogleConnectionsModule,
    GoogleSheetsWriter,
    SourceOperationLock,
  ],
})
export class GoogleSheetsModule {}
