import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { View } from '../views/entities/view.entity';
import { ViewPermission } from './entities/view-permission.entity';
import {
  PermissionTypeEnum,
  ViewStatusEnum,
} from '../../common/enums/database.enums';
import { DataSource as Source } from '../data-sources/entities/data-source.entity';
import { sourceGoogleAccess } from '../../google-sheets/google-source-access';
import { GoogleConnectionsService } from '../google-connections/google-connections.service';
import { GOOGLE_SHEETS_SCOPE } from '../google-connections/google-oauth.gateway';

@Injectable()
export class ViewAccessPolicy {
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly connections: GoogleConnectionsService,
    private readonly config: ConfigService,
  ) {}
  async role(
    view: View,
    userId?: string,
  ): Promise<'owner' | 'editor' | 'viewer'> {
    if (userId === view.ownerId) return 'owner';
    if (userId) {
      const grant = await this.database.manager.findOne(ViewPermission, {
        where: { viewId: view.id, userId },
      });
      if (grant?.permissionType === PermissionTypeEnum.EDIT) return 'editor';
    }
    return 'viewer';
  }
  async requireEditor(view: View, userId: string) {
    if (
      view.deletedAt ||
      view.status !== ViewStatusEnum.PUBLISHED ||
      (await this.role(view, userId)) === 'viewer'
    )
      throw new ForbiddenException('Bạn không có quyền sửa dữ liệu trang này.');
  }
  async capabilities(view: View, userId?: string) {
    const role = await this.role(view, userId);
    if (
      role === 'viewer' ||
      this.config.get<string>('SHEET2WEB_WRITE_ENABLED') !== 'true' ||
      !this.connections.configured()
    )
      return { role, canEdit: false };
    const source = await this.database.manager.findOne(Source, {
      where: {
        id: view.dataSourceId,
        ownerId: view.ownerId,
        deletedAt: IsNull(),
      },
    });
    const access = source && sourceGoogleAccess(source);
    if (!access) return { role, canEdit: false };
    try {
      const connection = await this.connections.findActive(access);
      return {
        role,
        canEdit: connection.scopes.includes(GOOGLE_SHEETS_SCOPE),
      };
    } catch {
      return { role, canEdit: false };
    }
  }
}
