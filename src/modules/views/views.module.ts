import { ViewPermissionsModule } from '../view-permissions/view-permissions.module';
import { Module } from '@nestjs/common';
import { ViewsService } from './views.service';
import { PublicViewsController, ViewsController } from './views.controller';
import { View } from './entities/view.entity';
import { TypeOrmModule } from '@nestjs/typeorm/dist/typeorm.module';
import { GoogleSheetsModule } from '../../google-sheets/google-sheets.module';
import { ViewSyncScheduler } from './view-sync.scheduler';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([View]),
    GoogleSheetsModule,
    UsersModule,
    ViewPermissionsModule,
  ],
  controllers: [ViewsController, PublicViewsController],
  providers: [ViewsService, ViewSyncScheduler],
  exports: [ViewsService],
})
export class ViewsModule {}
