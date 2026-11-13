import { GoogleConnectionsModule } from '../google-connections/google-connections.module';
import { ViewAccessPolicy } from './view-access.policy';
import { Module } from '@nestjs/common';
import { ViewPermissionsService } from './view-permissions.service';
import { ViewPermissionsController } from './view-permissions.controller';
import { ViewPermission } from './entities/view-permission.entity';
import { TypeOrmModule } from '@nestjs/typeorm/dist/typeorm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ViewPermission]),
    GoogleConnectionsModule,
  ],
  controllers: [ViewPermissionsController],
  providers: [ViewPermissionsService, ViewAccessPolicy],
  exports: [ViewAccessPolicy],
})
export class ViewPermissionsModule {}
