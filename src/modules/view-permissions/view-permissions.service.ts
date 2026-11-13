import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateViewPermissionDto } from './dto/create-view-permission.dto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource as TypeOrmDataSource, IsNull } from 'typeorm';
import { View } from '../views/entities/view.entity';
import { ViewPermission } from './entities/view-permission.entity';
import { User } from '../users/entities/user.entity';
import { PermissionTypeEnum } from '../../common/enums/database.enums';

@Injectable()
export class ViewPermissionsService {
  constructor(
    @InjectDataSource()
    private readonly typeOrmDataSource: TypeOrmDataSource,
  ) {}

  async create(
    userId: string,
    viewId: string,
    createViewPermissionDto: CreateViewPermissionDto,
  ) {
    const view = await this.findOwnedView(userId, viewId);
    const email = createViewPermissionDto.email.trim().toLowerCase();
    const targetUser = await this.typeOrmDataSource.manager
      .createQueryBuilder(User, 'targetUser')
      .where('LOWER(targetUser.email) = LOWER(:email)', { email })
      .andWhere('targetUser.deleted_at IS NULL')
      .getOne();

    if (!targetUser) {
      throw new NotFoundException('Không tìm thấy user.');
    }

    if (targetUser.id === userId) {
      throw new BadRequestException('Owner không cần được cấp quyền riêng.');
    }

    const existedPermission = await this.typeOrmDataSource.manager.findOne(
      ViewPermission,
      {
        where: {
          viewId: view.id,
          userId: targetUser.id,
        },
        relations: { user: true },
      },
    );

    if (existedPermission) {
      if (createViewPermissionDto.role) {
        existedPermission.permissionType =
          createViewPermissionDto.role === 'editor'
            ? PermissionTypeEnum.EDIT
            : PermissionTypeEnum.VIEW;
        await this.typeOrmDataSource.manager.save(
          ViewPermission,
          existedPermission,
        );
      }
      return this.toResponse(existedPermission);
    }

    const permission = this.typeOrmDataSource.manager.create(ViewPermission, {
      viewId: view.id,
      userId: targetUser.id,
      permissionType:
        createViewPermissionDto.role === 'editor'
          ? PermissionTypeEnum.EDIT
          : PermissionTypeEnum.VIEW,
      grantedBy: userId,
    });

    const savedPermission = await this.typeOrmDataSource.manager.save(
      ViewPermission,
      permission,
    );
    savedPermission.user = targetUser;

    return this.toResponse(savedPermission);
  }

  async findAll(userId: string, viewId: string) {
    const view = await this.findOwnedView(userId, viewId);
    const permissions = await this.typeOrmDataSource.manager.find(
      ViewPermission,
      {
        where: { viewId: view.id },
        relations: { user: true },
        order: { createdAt: 'DESC' },
      },
    );

    return {
      items: permissions.map((permission) => this.toResponse(permission)),
    };
  }

  async updateRole(
    userId: string,
    viewId: string,
    permissionId: string,
    role: 'viewer' | 'editor',
  ) {
    await this.findOwnedView(userId, viewId);
    const grant = await this.typeOrmDataSource.manager.findOne(ViewPermission, {
      where: { id: permissionId, viewId },
      relations: { user: true },
    });
    if (!grant) throw new NotFoundException('Không tìm thấy quyền truy cập.');
    grant.permissionType =
      role === 'editor' ? PermissionTypeEnum.EDIT : PermissionTypeEnum.VIEW;
    await this.typeOrmDataSource.manager.save(ViewPermission, grant);
    return this.toResponse(grant);
  }

  async remove(userId: string, viewId: string, permissionId: string) {
    const view = await this.findOwnedView(userId, viewId);
    const permission = await this.typeOrmDataSource.manager.findOne(
      ViewPermission,
      {
        where: {
          id: permissionId,
          viewId: view.id,
        },
      },
    );

    if (!permission) {
      throw new NotFoundException('Không tìm thấy permission.');
    }

    await this.typeOrmDataSource.manager.delete(ViewPermission, permission.id);

    return { success: true };
  }

  private async findOwnedView(userId: string, viewId: string) {
    const view = await this.typeOrmDataSource.manager.findOne(View, {
      where: { id: viewId, deletedAt: IsNull() },
    });

    if (!view) {
      throw new NotFoundException('Không tìm thấy view.');
    }

    if (view.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền quản lý view này.');
    }

    return view;
  }

  private toResponse(permission: ViewPermission) {
    return {
      id: permission.id,
      user: {
        id: permission.user.id,
        email: permission.user.email,
        name: permission.user.fullName,
      },
      role:
        permission.permissionType === PermissionTypeEnum.EDIT
          ? 'editor'
          : 'viewer',
      createdAt: permission.createdAt,
    };
  }
}
