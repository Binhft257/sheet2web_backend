import { GoogleSheetsModule } from '../../google-sheets/google-sheets.module';
import { ViewsModule } from '../views/views.module';
import { ViewPermissionsModule } from '../view-permissions/view-permissions.module';
import { CellChangesController } from './cell-changes.controller';
import { CellChangeWorker } from './cell-change.worker';
import { Module } from '@nestjs/common';
import { CellChangeLogsService } from './cell-change-logs.service';
import { CellChangeLog } from './entities/cell-change-log.entity';
import { TypeOrmModule } from '@nestjs/typeorm/dist/typeorm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CellChangeLog]),
    GoogleSheetsModule,
    ViewsModule,
    ViewPermissionsModule,
  ],
  providers: [CellChangeLogsService, CellChangeWorker],
  controllers: [CellChangesController],
})
export class CellChangeLogsModule {}
