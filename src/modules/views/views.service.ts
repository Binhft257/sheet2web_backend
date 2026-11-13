import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateViewDto } from './dto/create-view.dto';
import { ListMyViewsQueryDto } from './dto/list-my-views-query.dto';
import { UpdateViewDto } from './dto/update-view.dto';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource as TypeOrmDataSource,
  EntityManager,
  IsNull,
  QueryFailedError,
} from 'typeorm';
import { View } from './entities/view.entity';
import {
  AccessModeEnum,
  PermissionTypeEnum,
  SelectionTypeEnum,
  SyncStatusEnum,
  TokenStatusEnum,
  ViewStatusEnum,
} from '../../common/enums/database.enums';
import { DataSource as DataSourceEntity } from '../data-sources/entities/data-source.entity';
import { SourceSheet } from '../source-sheets/entities/source-sheet.entity';
import { createBaseSlug } from './utils/slug.util';
import {
  buildA1Range,
  escapeSheetName,
  validateRangeA1Notation,
} from '../data-sources/utils/sheet-range.util';
import { Optional } from '@nestjs/common';
import { SourceOperationLock } from '../../google-sheets/source-operation-lock';
import { ViewAccessPolicy } from '../view-permissions/view-access.policy';
import { sourceGoogleAccess } from '../../google-sheets/google-source-access';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';
import { ViewSnapshot } from '../view-snapshots/entities/view-snapshot.entity';
import { ViewPermission } from '../view-permissions/entities/view-permission.entity';
import { ShareToken } from '../share-tokens/entities/share-token.entity';
import { hashShareToken } from '../share-tokens/utils/share-token.util';
import { readGridSnapshotMetadata } from '../../google-sheets/grid/grid-snapshot.metadata';
import { hashGridSnapshot } from '../../google-sheets/grid/grid-snapshot.hash';

type PublicationResult = {
  id: string;
  slug: string;
  status: ViewStatusEnum;
  publishedAt: Date | null | undefined;
  snapshot: {
    id: string;
    versionNo: number;
    rowCount: number;
    fetchedAt: Date | null | undefined;
  };
  url: string;
};

type PublicationRequest = {
  mode: 'manual' | 'background';
  changes?: UpdateViewDto;
};

@Injectable()
export class ViewsService {
  private readonly publications = new Map<
    string,
    PublicationRequest & { promise: Promise<PublicationResult> }
  >();

  constructor(
    @InjectDataSource()
    private readonly typeOrmDataSource: TypeOrmDataSource,
    private readonly googleSheetsService: GoogleSheetsService,
    @Optional() private readonly accessPolicy?: ViewAccessPolicy,
    @Optional() private readonly sourceLocks?: SourceOperationLock,
  ) {}

  async listMy(userId: string, listMyViewsQueryDto: ListMyViewsQueryDto) {
    const { page, limit, skip } = this.resolvePagination(
      listMyViewsQueryDto.page,
      listMyViewsQueryDto.limit,
    );
    const normalizedSearch = listMyViewsQueryDto.search?.trim();

    const queryBuilder = this.typeOrmDataSource.manager
      .createQueryBuilder(View, 'view')
      .where('view.owner_id = :userId', { userId })
      .andWhere('view.deleted_at IS NULL');

    if (normalizedSearch) {
      queryBuilder.andWhere('view.name ILIKE :search', {
        search: `%${normalizedSearch}%`,
      });
    }

    if (listMyViewsQueryDto.status) {
      queryBuilder.andWhere('view.status = :status', {
        status: listMyViewsQueryDto.status,
      });
    }

    if (listMyViewsQueryDto.accessMode) {
      queryBuilder.andWhere('view.access_mode = :accessMode', {
        accessMode: listMyViewsQueryDto.accessMode,
      });
    }

    queryBuilder
      // Background sync must not move existing pages around the list.
      .orderBy('view.created_at', 'DESC')
      .addOrderBy('view.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [views, total] = await queryBuilder.getManyAndCount();

    if (views.length === 0) {
      return {
        items: [],
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }

    const viewIds = views.map((view) => view.id);
    const dataSourceIds = Array.from(
      new Set(views.map((view) => view.dataSourceId).filter((id) => !!id)),
    );
    const sourceSheetIds = Array.from(
      new Set(views.map((view) => view.sourceSheetId).filter((id) => !!id)),
    );

    const [dataSources, sourceSheets, currentSnapshots] = await Promise.all([
      dataSourceIds.length === 0
        ? Promise.resolve([] as DataSourceEntity[])
        : this.typeOrmDataSource.manager
            .createQueryBuilder(DataSourceEntity, 'dataSource')
            .where('dataSource.id IN (:...dataSourceIds)', { dataSourceIds })
            .andWhere('dataSource.deleted_at IS NULL')
            .getMany(),
      sourceSheetIds.length === 0
        ? Promise.resolve([] as SourceSheet[])
        : this.typeOrmDataSource.manager
            .createQueryBuilder(SourceSheet, 'sourceSheet')
            .where('sourceSheet.id IN (:...sourceSheetIds)', { sourceSheetIds })
            .getMany(),
      this.typeOrmDataSource.manager
        .createQueryBuilder(ViewSnapshot, 'snapshot')
        .where('snapshot.view_id IN (:...viewIds)', { viewIds })
        .andWhere('snapshot.is_current = true')
        .orderBy('snapshot.view_id', 'ASC')
        .addOrderBy('snapshot.version_no', 'DESC')
        .getMany(),
    ]);

    const dataSourceById = new Map(
      dataSources.map((dataSource) => [dataSource.id, dataSource]),
    );
    const sourceSheetById = new Map(
      sourceSheets.map((sourceSheet) => [sourceSheet.id, sourceSheet]),
    );
    const currentSnapshotByViewId = new Map<string, ViewSnapshot>();
    for (const currentSnapshot of currentSnapshots) {
      if (!currentSnapshotByViewId.has(currentSnapshot.viewId)) {
        currentSnapshotByViewId.set(currentSnapshot.viewId, currentSnapshot);
      }
    }

    return {
      items: views.map((view) => {
        const dataSource = dataSourceById.get(view.dataSourceId);
        const sourceSheet = view.sourceSheetId
          ? sourceSheetById.get(view.sourceSheetId)
          : undefined;
        const currentSnapshot = currentSnapshotByViewId.get(view.id);

        return {
          id: view.id,
          name: view.name,
          slug: view.slug,
          status: view.status,
          accessMode: view.accessMode,
          selectionType: view.selectionType,
          rangeA1Notation: view.rangeA1Notation,
          useFirstRowAsHeader: view.useFirstRowAsHeader,
          refreshIntervalSeconds: view.refreshIntervalSeconds,
          allowThemeSwitch: view.allowThemeSwitch,
          lastPublishedAt: view.lastPublishedAt,
          createdAt: view.createdAt,
          updatedAt: view.updatedAt,
          dataSource: dataSource
            ? {
                id: dataSource.id,
                title: dataSource.title,
              }
            : null,
          sourceSheet: sourceSheet
            ? {
                id: sourceSheet.id,
                sheetName: sourceSheet.sheetName,
              }
            : null,
          currentSnapshot: currentSnapshot
            ? {
                id: currentSnapshot.id,
                versionNo: Number(currentSnapshot.versionNo),
                rowCount: currentSnapshot.rowCount,
                fetchedAt: currentSnapshot.fetchedAt,
              }
            : null,
          publicUrl: `/v/${view.slug}`,
        };
      }),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async create(userId: string, createViewDto: CreateViewDto) {
    const normalizedName = createViewDto.name?.trim();
    const normalizedRange = createViewDto.rangeA1Notation?.trim();

    this.validateSelectionRules(
      createViewDto.selectionType,
      createViewDto.sourceSheetId,
      normalizedRange,
    );

    if (
      createViewDto.selectionType === SelectionTypeEnum.RANGE &&
      normalizedRange
    ) {
      validateRangeA1Notation(normalizedRange, Number.MAX_SAFE_INTEGER);
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.typeOrmDataSource.transaction(async (manager) => {
          const dataSource = await manager.findOne(DataSourceEntity, {
            where: {
              id: createViewDto.dataSourceId,
              deletedAt: IsNull(),
            },
          });

          if (!dataSource) {
            throw new NotFoundException('Không tìm thấy nguồn dữ liệu.');
          }

          if (dataSource.ownerId !== userId) {
            throw new ForbiddenException(
              'Bạn không có quyền tạo view cho nguồn dữ liệu này.',
            );
          }

          const sourceSheet = await manager.findOne(SourceSheet, {
            where: {
              id: createViewDto.sourceSheetId!,
              dataSourceId: createViewDto.dataSourceId,
            },
          });

          if (!sourceSheet) {
            throw new NotFoundException(
              'Không tìm thấy sheet trong nguồn dữ liệu này.',
            );
          }

          const resolvedName = normalizedName || sourceSheet.sheetName?.trim();
          if (!resolvedName) {
            throw new BadRequestException('Không thể xác định tên view.');
          }

          const slug = await this.generateUniqueSlug(manager, resolvedName);

          const viewToCreate = manager.create(View, {
            ownerId: userId,
            dataSourceId: createViewDto.dataSourceId,
            sourceSheetId: createViewDto.sourceSheetId!,
            sourceTableId: null,
            themeId: createViewDto.themeId ?? null,
            name: resolvedName,
            slug,
            accessMode: createViewDto.accessMode,
            status: ViewStatusEnum.DRAFT,
            selectionType: createViewDto.selectionType,
            rangeA1Notation:
              createViewDto.selectionType === SelectionTypeEnum.RANGE
                ? normalizedRange
                : null,
            useFirstRowAsHeader: createViewDto.useFirstRowAsHeader ?? true,
            refreshIntervalSeconds: createViewDto.refreshIntervalSeconds ?? 60,
            allowThemeSwitch: createViewDto.allowThemeSwitch ?? false,
            themeOverrideJson: createViewDto.themeOverrideJson ?? {},
            settingsJson: createViewDto.settingsJson ?? {},
          });

          const savedView = await manager.save(View, viewToCreate);
          return this.toCreateResponse(savedView);
        });
      } catch (error) {
        if (this.isSlugUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Không thể tạo slug duy nhất cho view này.');
  }

  async update(userId: string, viewId: string, updateViewDto: UpdateViewDto) {
    return this.updateByStatus(
      userId,
      viewId,
      updateViewDto,
      ViewStatusEnum.DRAFT,
      'Chỉ có thể sửa view nháp.',
    );
  }

  async updatePublished(
    userId: string,
    viewId: string,
    updateViewDto: UpdateViewDto,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const publication = await this.runPublication(userId, viewId, {
          mode: 'manual',
          changes: updateViewDto,
        });
        return { ...(await this.findOne(userId, viewId)), publication };
      } catch (error) {
        if (!this.isSlugUniqueViolation(error)) throw error;
      }
    }
    throw new ConflictException('Không thể tạo slug duy nhất cho view này.');
  }

  private async updateByStatus(
    userId: string,
    viewId: string,
    updateViewDto: UpdateViewDto,
    expectedStatus: ViewStatusEnum,
    invalidStatusMessage: string,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.typeOrmDataSource.transaction(async (manager) => {
          const view = await manager.findOne(View, {
            where: { id: viewId, deletedAt: IsNull() },
            lock: { mode: 'pessimistic_write' },
          });

          if (!view) {
            throw new NotFoundException('Không tìm thấy view.');
          }

          if (view.ownerId !== userId) {
            throw new ForbiddenException('Bạn không có quyền sửa view này.');
          }

          if (view.status !== expectedStatus) {
            throw new BadRequestException(invalidStatusMessage);
          }

          await this.applyViewChanges(manager, view, updateViewDto);

          const savedView = await manager.save(View, view);
          return this.toUpdateResponse(savedView);
        });
      } catch (error) {
        if (this.isSlugUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Không thể tạo slug duy nhất cho view này.');
  }

  async publish(
    userId: string,
    viewId: string,
    mode: 'manual' | 'background' = 'manual',
  ): Promise<PublicationResult> {
    return this.runPublication(userId, viewId, { mode });
  }

  private async runPublication(
    userId: string,
    viewId: string,
    request: PublicationRequest,
  ): Promise<PublicationResult> {
    // User ID is part of the key: callers must never borrow another owner's authorization.
    const key = `${userId}:${viewId}`;
    const existing = this.publications.get(key);
    if (existing) {
      if (
        request.changes ||
        existing.changes ||
        (request.mode === 'manual' && existing.mode === 'background')
      ) {
        // Distinct edits must not borrow another request's configuration or failure.
        await existing.promise.catch(() => undefined);
        return this.runPublication(userId, viewId, request);
      }
      return existing.promise;
    }
    const promise = this.publishWithSourceLock(userId, viewId, request);
    this.publications.set(key, { ...request, promise });
    try {
      return await promise;
    } finally {
      if (this.publications.get(key)?.promise === promise)
        this.publications.delete(key);
    }
  }

  private async publishWithSourceLock(
    userId: string,
    viewId: string,
    request: PublicationRequest,
  ): Promise<PublicationResult> {
    if (this.sourceLocks) {
      const view = await this.typeOrmDataSource.manager.findOne(View, {
        where: { id: viewId, ownerId: userId, deletedAt: IsNull() },
      });
      const source =
        view &&
        (await this.typeOrmDataSource.manager.findOne(DataSourceEntity, {
          where: {
            id: view.dataSourceId,
            ownerId: userId,
            deletedAt: IsNull(),
          },
        }));
      if (source?.spreadsheetId && sourceGoogleAccess(source))
        return this.sourceLocks.run(source.spreadsheetId, () =>
          this.publishSnapshot(userId, viewId, request),
        );
    }
    return this.publishSnapshot(userId, viewId, request);
  }

  private async publishSnapshot(
    userId: string,
    viewId: string,
    { mode, changes }: PublicationRequest,
  ): Promise<PublicationResult> {
    const view = await this.typeOrmDataSource.manager.findOne(View, {
      where: { id: viewId, deletedAt: IsNull() },
    });

    if (!view) {
      throw new NotFoundException('Không tìm thấy view.');
    }

    if (view.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền publish view này.');
    }

    if (changes && view.status !== ViewStatusEnum.PUBLISHED) {
      throw new BadRequestException('Chỉ có thể sửa view đã publish.');
    }

    const expectedConfiguration = this.publicationConfiguration(view);
    const candidate = Object.assign(new View(), view);
    if (changes) {
      await this.applyViewChanges(
        this.typeOrmDataSource.manager,
        candidate,
        changes,
      );
    }
    this.validatePublishSelection(candidate);

    const dataSource = await this.typeOrmDataSource.manager.findOne(
      DataSourceEntity,
      {
        where: {
          id: view.dataSourceId,
          deletedAt: IsNull(),
        },
      },
    );

    if (!dataSource) {
      throw new NotFoundException('Không tìm thấy nguồn dữ liệu.');
    }

    if (dataSource.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền publish view này.');
    }

    if (!dataSource.spreadsheetId) {
      throw new BadRequestException(
        'Nguồn dữ liệu không có spreadsheet id hợp lệ.',
      );
    }

    const sourceSheet = await this.typeOrmDataSource.manager.findOne(
      SourceSheet,
      {
        where: {
          id: candidate.sourceSheetId!,
          dataSourceId: view.dataSourceId,
        },
      },
    );

    if (!sourceSheet) {
      throw new NotFoundException(
        'Không tìm thấy sheet trong nguồn dữ liệu này.',
      );
    }

    const baselineSnapshot = await this.typeOrmDataSource.manager
      .createQueryBuilder(ViewSnapshot, 'snapshot')
      .where('snapshot.view_id = :viewId', { viewId: view.id })
      .andWhere('snapshot.is_current = true')
      .orderBy('snapshot.version_no', 'DESC')
      .getOne();
    const grid = await this.googleSheetsService.getGridSnapshot({
      spreadsheetId: dataSource.spreadsheetId,
      googleSheetId: sourceSheet.googleSheetId,
      sheetName: sourceSheet.sheetName,
      rangeA1Notation:
        candidate.selectionType === SelectionTypeEnum.RANGE
          ? candidate.rangeA1Notation!
          : undefined,
      useFirstRowAsHeader: candidate.useFirstRowAsHeader,
      ...(sourceGoogleAccess(dataSource)
        ? { googleAccess: sourceGoogleAccess(dataSource) }
        : {}),
    });
    const resolvedRange = this.resolvePublishRange(candidate, grid.sheetName);
    const { headers, rows } = grid;
    const dataHash = hashGridSnapshot(grid);

    return await this.typeOrmDataSource.transaction(async (manager) => {
      const freshView = await manager.findOne(View, {
        where: { id: view.id, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (!freshView) {
        throw new NotFoundException('Không tìm thấy view.');
      }

      if (freshView.ownerId !== userId) {
        throw new ForbiddenException('Bạn không có quyền publish view này.');
      }

      if (this.publicationConfiguration(freshView) !== expectedConfiguration) {
        throw new ConflictException(
          'Cấu hình trang đã thay đổi trong lúc đọc. Vui lòng xuất bản lại.',
        );
      }
      if (changes) {
        Object.assign(freshView, this.viewConfiguration(candidate));
      }
      const currentSnapshot = await manager
        .createQueryBuilder(ViewSnapshot, 'snapshot')
        .where('snapshot.view_id = :viewId', { viewId: freshView.id })
        .andWhere('snapshot.is_current = true')
        .orderBy('snapshot.version_no', 'DESC')
        .getOne();
      if (
        currentSnapshot?.id !== baselineSnapshot?.id &&
        currentSnapshot?.dataHash !== dataHash
      ) {
        throw new ConflictException(
          'Trang vừa được đồng bộ bởi tác vụ khác. Vui lòng thử lại.',
        );
      }
      if (
        currentSnapshot?.dataHash === dataHash &&
        readGridSnapshotMetadata(currentSnapshot.resolvedMetaJson)
      ) {
        if (mode === 'manual') {
          freshView.status = ViewStatusEnum.PUBLISHED;
          freshView.lastPublishedAt = new Date();
          await manager.save(View, freshView);
        }
        return this.publicationResponse(freshView, currentSnapshot);
      }

      await manager
        .createQueryBuilder()
        .update(ViewSnapshot)
        .set({ isCurrent: false })
        .where('view_id = :viewId', { viewId: freshView.id })
        .andWhere('is_current = true')
        .execute();

      const rawMaxVersion = await manager
        .createQueryBuilder(ViewSnapshot, 'snapshot')
        .select('MAX(snapshot.version_no)', 'maxVersion')
        .where('snapshot.view_id = :viewId', { viewId: freshView.id })
        .getRawOne<{ maxVersion: string | null }>();

      const currentMaxVersion = Number(rawMaxVersion?.maxVersion ?? 0);
      const nextVersion = Number.isFinite(currentMaxVersion)
        ? currentMaxVersion + 1
        : 1;

      const snapshotToCreate = manager.create(ViewSnapshot, {
        viewId: freshView.id,
        versionNo: String(nextVersion),
        isCurrent: true,
        resolvedSelectionType: freshView.selectionType,
        resolvedSheetNameSnapshot: grid.sheetName,
        resolvedTableNameSnapshot: null,
        resolvedRangeA1: resolvedRange,
        resolvedMetaJson: {
          gridLayout: grid.gridLayout,
          issues: grid.issues,
          visibilityPolicyVersion: 1,
        },
        dataHash,
        headersJson: headers,
        rowsJson: rows,
        rowCount: rows.length,
        fetchedAt: new Date(),
        syncStatus: SyncStatusEnum.SUCCESS,
      });

      const savedSnapshot = await manager.save(ViewSnapshot, snapshotToCreate);

      freshView.status = ViewStatusEnum.PUBLISHED;
      freshView.lastPublishedAt = new Date();
      const savedView = await manager.save(View, freshView);

      const snapshotRows = await manager
        .createQueryBuilder(ViewSnapshot, 'snapshot')
        .select('snapshot.id', 'id')
        .where('snapshot.view_id = :viewId', { viewId: freshView.id })
        .orderBy('snapshot.version_no', 'DESC')
        .getRawMany<{ id: string }>();

      const staleSnapshotIds = snapshotRows.slice(5).map((row) => row.id);
      if (staleSnapshotIds.length > 0) {
        await manager.delete(ViewSnapshot, staleSnapshotIds);
      }

      return this.publicationResponse(savedView, savedSnapshot);
    });
  }

  async findOne(userId: string, viewId: string) {
    const view = await this.typeOrmDataSource.manager.findOne(View, {
      where: { id: viewId, deletedAt: IsNull() },
    });

    if (!view) {
      throw new NotFoundException('Không tìm thấy view.');
    }

    if (view.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem view này.');
    }

    const [dataSource, sourceSheet, currentSnapshot] = await Promise.all([
      this.typeOrmDataSource.manager.findOne(DataSourceEntity, {
        where: {
          id: view.dataSourceId,
          deletedAt: IsNull(),
        },
      }),
      view.sourceSheetId
        ? this.typeOrmDataSource.manager.findOne(SourceSheet, {
            where: {
              id: view.sourceSheetId,
              dataSourceId: view.dataSourceId,
            },
          })
        : Promise.resolve(null),
      this.typeOrmDataSource.manager
        .createQueryBuilder(ViewSnapshot, 'snapshot')
        .where('snapshot.view_id = :viewId', { viewId: view.id })
        .andWhere('snapshot.is_current = true')
        .orderBy('snapshot.version_no', 'DESC')
        .getOne(),
    ]);

    return this.toDetailResponse(
      view,
      dataSource,
      sourceSheet,
      currentSnapshot,
    );
  }

  async findPublishedBySlug(
    slug: string,
    userId?: string,
    shareToken?: string,
  ) {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      throw new NotFoundException('Không tìm thấy view.');
    }

    const view = await this.typeOrmDataSource.manager
      .createQueryBuilder(View, 'view')
      .where('LOWER(view.slug) = LOWER(:slug)', { slug: normalizedSlug })
      .andWhere('view.deleted_at IS NULL')
      .andWhere('view.status = :status', { status: ViewStatusEnum.PUBLISHED })
      .getOne();

    if (!view) {
      throw new NotFoundException('Không tìm thấy view.');
    }

    const currentSnapshot = await this.typeOrmDataSource.manager
      .createQueryBuilder(ViewSnapshot, 'snapshot')
      .where('snapshot.view_id = :viewId', { viewId: view.id })
      .andWhere('snapshot.is_current = true')
      .orderBy('snapshot.version_no', 'DESC')
      .getOne();

    if (!currentSnapshot) {
      throw new ConflictException('View chưa có snapshot hiện tại.');
    }

    if (view.accessMode === AccessModeEnum.PRIVATE) {
      const canView = await this.canViewPrivatePublishedView(
        view,
        userId,
        shareToken,
        Boolean(readGridSnapshotMetadata(currentSnapshot.resolvedMetaJson)),
      );

      if (!canView) {
        throw new ForbiddenException('Bạn không có quyền xem view này.');
      }
    }

    const response = this.toPublishedResponse(view, currentSnapshot);
    return this.accessPolicy
      ? {
          ...response,
          capabilities: await this.accessPolicy.capabilities(view, userId),
        }
      : response;
  }

  async remove(userId: string, viewId: string) {
    const view = await this.typeOrmDataSource.manager.findOne(View, {
      where: { id: viewId, deletedAt: IsNull() },
    });

    if (!view) {
      throw new NotFoundException('Không tìm thấy view.');
    }

    if (view.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xóa view này.');
    }

    view.deletedAt = new Date();
    await this.typeOrmDataSource.manager.save(View, view);

    return {
      message: 'Xóa view thành công',
      id: view.id,
      status: view.status,
      deletedAt: view.deletedAt,
    };
  }

  private async canViewPrivatePublishedView(
    view: View,
    userId?: string,
    shareToken?: string,
    consumeTokenUse = true,
  ) {
    if (userId && view.ownerId === userId) {
      return true;
    }

    if (userId) {
      const hasPermission = await this.typeOrmDataSource.manager
        .createQueryBuilder(ViewPermission, 'permission')
        .where('permission.view_id = :viewId', { viewId: view.id })
        .andWhere('permission.user_id = :userId', { userId })
        .andWhere('permission.permission_type IN (:...permissionTypes)', {
          permissionTypes: [PermissionTypeEnum.VIEW, PermissionTypeEnum.EDIT],
        })
        .getExists();

      if (hasPermission) {
        return true;
      }
    }

    return this.isValidShareToken(view.id, shareToken, consumeTokenUse);
  }

  private async isValidShareToken(
    viewId: string,
    shareToken?: string,
    consumeUse = true,
  ) {
    const normalizedToken = shareToken?.trim();
    if (!normalizedToken) {
      return false;
    }

    const tokenHash = hashShareToken(normalizedToken);
    const savedToken = await this.typeOrmDataSource.manager.findOne(
      ShareToken,
      {
        where: { viewId, tokenHash },
      },
    );

    if (!savedToken || savedToken.status !== TokenStatusEnum.ACTIVE) {
      return false;
    }

    const now = new Date();
    if (savedToken.expiresAt && savedToken.expiresAt <= now) {
      return false;
    }

    if (
      typeof savedToken.maxUses === 'number' &&
      savedToken.usedCount >= savedToken.maxUses
    ) {
      return false;
    }

    // A 409 response contains no usable page and must not consume a limited share link.
    if (consumeUse) {
      savedToken.usedCount += 1;
      savedToken.lastUsedAt = now;
      await this.typeOrmDataSource.manager.save(ShareToken, savedToken);
    }

    return true;
  }

  private validateSelectionRules(
    selectionType: SelectionTypeEnum,
    sourceSheetId?: string | null,
    rangeA1Notation?: string,
  ) {
    if (selectionType === SelectionTypeEnum.TABLE) {
      throw new BadRequestException(
        'Selection type table chưa được hỗ trợ ở phase này.',
      );
    }

    if (
      selectionType !== SelectionTypeEnum.FULL_SHEET &&
      selectionType !== SelectionTypeEnum.RANGE
    ) {
      throw new BadRequestException('Selection type không hợp lệ.');
    }

    if (!sourceSheetId) {
      throw new BadRequestException('sourceSheetId là bắt buộc.');
    }

    if (selectionType === SelectionTypeEnum.FULL_SHEET && rangeA1Notation) {
      throw new BadRequestException(
        'full_sheet không cho phép rangeA1Notation.',
      );
    }

    if (selectionType === SelectionTypeEnum.RANGE && !rangeA1Notation) {
      throw new BadRequestException('rangeA1Notation là bắt buộc cho range.');
    }
  }

  private validatePublishSelection(view: View) {
    if (view.selectionType === SelectionTypeEnum.TABLE) {
      throw new BadRequestException(
        'Selection type table chưa được hỗ trợ ở phase này.',
      );
    }

    if (!view.dataSourceId) {
      throw new BadRequestException('View không có data source hợp lệ.');
    }

    if (!view.sourceSheetId) {
      throw new BadRequestException('View không có source sheet hợp lệ.');
    }

    if (
      view.selectionType === SelectionTypeEnum.RANGE &&
      !view.rangeA1Notation?.trim()
    ) {
      throw new BadRequestException('View không có rangeA1Notation hợp lệ.');
    }
  }

  private resolvePublishRange(view: View, sheetName: string) {
    if (view.selectionType === SelectionTypeEnum.FULL_SHEET) {
      return escapeSheetName(sheetName);
    }

    const safeRange = validateRangeA1Notation(
      view.rangeA1Notation as string,
      Number.MAX_SAFE_INTEGER,
    );
    return buildA1Range(sheetName, safeRange);
  }

  private async generateUniqueSlug(
    manager: EntityManager,
    viewName: string,
    excludeViewId?: string,
  ) {
    const baseSlug = createBaseSlug(viewName);
    let suffix = 1;

    while (suffix <= 1000) {
      const candidate = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
      const query = manager
        .createQueryBuilder(View, 'view')
        .where('LOWER(view.slug) = LOWER(:slug)', { slug: candidate })
        .andWhere('view.deleted_at IS NULL');

      if (excludeViewId) {
        query.andWhere('view.id != :excludeViewId', { excludeViewId });
      }

      const existed = await query.getExists();
      if (!existed) {
        return candidate;
      }

      suffix += 1;
    }

    throw new ConflictException('Không thể tạo slug duy nhất cho view này.');
  }

  private isSlugUniqueViolation(error: unknown) {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = (
      error as QueryFailedError & {
        driverError?: {
          code?: string;
          table?: string;
          constraint?: string;
          detail?: string;
        };
      }
    ).driverError;

    if (driverError?.code !== '23505') {
      return false;
    }

    const table = driverError.table?.toLowerCase() ?? '';
    const constraint = driverError.constraint?.toLowerCase() ?? '';
    const detail = driverError.detail?.toLowerCase() ?? '';

    return (
      table === 'views' ||
      constraint.includes('view') ||
      constraint.includes('slug') ||
      detail.includes('view') ||
      detail.includes('slug')
    );
  }

  private resolvePagination(page?: number, limit?: number) {
    const parsedPage = Number(page ?? 1);
    const parsedLimit = Number(limit ?? 20);

    const safePage =
      Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const safeLimit =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 20;

    return {
      page: safePage,
      limit: safeLimit,
      skip: (safePage - 1) * safeLimit,
    };
  }

  private toCreateResponse(view: View) {
    return {
      id: view.id,
      name: view.name,
      slug: view.slug,
      status: view.status,
      accessMode: view.accessMode,
      selectionType: view.selectionType,
      dataSourceId: view.dataSourceId,
      sourceSheetId: view.sourceSheetId,
      rangeA1Notation: view.rangeA1Notation,
      useFirstRowAsHeader: view.useFirstRowAsHeader,
      refreshIntervalSeconds: view.refreshIntervalSeconds,
      allowThemeSwitch: view.allowThemeSwitch,
      createdAt: view.createdAt,
    };
  }

  private toUpdateResponse(view: View) {
    return {
      id: view.id,
      name: view.name,
      slug: view.slug,
      status: view.status,
      accessMode: view.accessMode,
      selectionType: view.selectionType,
      dataSourceId: view.dataSourceId,
      sourceSheetId: view.sourceSheetId,
      rangeA1Notation: view.rangeA1Notation,
      useFirstRowAsHeader: view.useFirstRowAsHeader,
      refreshIntervalSeconds: view.refreshIntervalSeconds,
      allowThemeSwitch: view.allowThemeSwitch,
      updatedAt: view.updatedAt,
    };
  }

  private toPublishedResponse(view: View, currentSnapshot: ViewSnapshot) {
    const metadata = readGridSnapshotMetadata(currentSnapshot.resolvedMetaJson);
    if (!metadata) {
      // Historical snapshots have no visibility evidence. Never expose them through a legacy fallback.
      throw new ConflictException(
        'Trang cần được xuất bản hoặc đồng bộ lại để kiểm tra dữ liệu ẩn.',
      );
    }
    return {
      view: {
        id: view.id,
        name: view.name,
        slug: view.slug,
        accessMode: view.accessMode,
        themeId: view.themeId,
        themeOverrideJson: view.themeOverrideJson,
        settingsJson: view.settingsJson,
        allowThemeSwitch: view.allowThemeSwitch,
        lastPublishedAt: view.lastPublishedAt,
      },
      snapshot: {
        id: currentSnapshot.id,
        versionNo: Number(currentSnapshot.versionNo),
        headers: Array.isArray(currentSnapshot.headersJson)
          ? currentSnapshot.headersJson
          : [],
        rows: Array.isArray(currentSnapshot.rowsJson)
          ? currentSnapshot.rowsJson
          : [],
        rowCount: currentSnapshot.rowCount,
        fetchedAt: currentSnapshot.fetchedAt,
        gridLayout: metadata.gridLayout,
        issues: metadata.issues,
      },
    };
  }

  private toDetailResponse(
    view: View,
    dataSource?: DataSourceEntity | null,
    sourceSheet?: SourceSheet | null,
    currentSnapshot?: ViewSnapshot | null,
  ) {
    return {
      id: view.id,
      name: view.name,
      slug: view.slug,
      status: view.status,
      accessMode: view.accessMode,
      selectionType: view.selectionType,
      dataSourceId: view.dataSourceId,
      sourceSheetId: view.sourceSheetId,
      rangeA1Notation: view.rangeA1Notation,
      useFirstRowAsHeader: view.useFirstRowAsHeader,
      refreshIntervalSeconds: view.refreshIntervalSeconds,
      allowThemeSwitch: view.allowThemeSwitch,
      themeId: view.themeId,
      themeOverrideJson: view.themeOverrideJson,
      settingsJson: view.settingsJson,
      lastPublishedAt: view.lastPublishedAt,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      dataSource: dataSource
        ? {
            id: dataSource.id,
            title: dataSource.title,
            googleConnectionId:
              sourceGoogleAccess(dataSource)?.connectionId ?? null,
            sourceType: dataSource.sourceType,
            sourceStatus: dataSource.sourceStatus,
            spreadsheetId: dataSource.spreadsheetId,
            lastSyncedStructureAt: dataSource.lastSyncedStructureAt,
          }
        : null,
      sourceSheet: sourceSheet
        ? {
            id: sourceSheet.id,
            sheetName: sourceSheet.sheetName,
            googleSheetId: sourceSheet.googleSheetId,
            gid: sourceSheet.gid,
            sortOrder: sourceSheet.sortOrder,
            isHidden: sourceSheet.isHidden,
            metadataJson: sourceSheet.metadataJson,
          }
        : null,
      currentSnapshot: currentSnapshot
        ? {
            id: currentSnapshot.id,
            versionNo: Number(currentSnapshot.versionNo),
            rowCount: currentSnapshot.rowCount,
            fetchedAt: currentSnapshot.fetchedAt,
            syncStatus: currentSnapshot.syncStatus,
            resolvedRangeA1: currentSnapshot.resolvedRangeA1,
          }
        : null,
    };
  }

  private async applyViewChanges(
    manager: EntityManager,
    view: View,
    changes: UpdateViewDto,
  ): Promise<void> {
    const selectionType = changes.selectionType ?? view.selectionType;
    const sourceSheetId =
      changes.sourceSheetId !== undefined
        ? changes.sourceSheetId
        : view.sourceSheetId;
    const rangeValue =
      changes.rangeA1Notation !== undefined
        ? changes.rangeA1Notation
        : view.rangeA1Notation;
    const range = typeof rangeValue === 'string' ? rangeValue.trim() : null;
    if (
      selectionType === SelectionTypeEnum.FULL_SHEET &&
      typeof changes.rangeA1Notation === 'string' &&
      changes.rangeA1Notation.trim()
    ) {
      throw new BadRequestException(
        'full_sheet không cho phép rangeA1Notation.',
      );
    }
    const normalizedRange =
      selectionType === SelectionTypeEnum.RANGE ? range : null;
    this.validateSelectionRules(
      selectionType,
      sourceSheetId,
      normalizedRange ?? undefined,
    );
    if (selectionType === SelectionTypeEnum.RANGE) {
      validateRangeA1Notation(normalizedRange!, Number.MAX_SAFE_INTEGER);
    }
    const sourceSheet = await manager.findOne(SourceSheet, {
      where: { id: sourceSheetId!, dataSourceId: view.dataSourceId },
    });
    if (!sourceSheet) {
      throw new NotFoundException(
        'Không tìm thấy sheet trong nguồn dữ liệu này.',
      );
    }
    if (changes.name !== undefined) {
      if (typeof changes.name !== 'string' || !changes.name.trim()) {
        throw new BadRequestException('name không được để trống.');
      }
      const name = changes.name.trim();
      if (name !== view.name) {
        view.slug = await this.generateUniqueSlug(manager, name, view.id);
      }
      view.name = name;
    }
    Object.assign(view, {
      sourceSheetId,
      selectionType,
      rangeA1Notation: normalizedRange,
    });
    // Share the same writable fields between draft saving and atomic publication.
    const fields = [
      'accessMode',
      'useFirstRowAsHeader',
      'refreshIntervalSeconds',
      'allowThemeSwitch',
      'themeId',
      'themeOverrideJson',
      'settingsJson',
    ] as const;
    for (const field of fields) {
      if (changes[field] !== undefined) {
        Object.assign(view, { [field]: changes[field] });
      }
    }
  }

  private viewConfiguration(view: View) {
    return {
      name: view.name,
      slug: view.slug,
      sourceSheetId: view.sourceSheetId,
      selectionType: view.selectionType,
      rangeA1Notation: view.rangeA1Notation,
      accessMode: view.accessMode,
      useFirstRowAsHeader: view.useFirstRowAsHeader,
      refreshIntervalSeconds: view.refreshIntervalSeconds,
      allowThemeSwitch: view.allowThemeSwitch,
      themeId: view.themeId,
      themeOverrideJson: view.themeOverrideJson,
      settingsJson: view.settingsJson,
    };
  }

  private publicationConfiguration(view: View): string {
    return JSON.stringify({
      ownerId: view.ownerId,
      dataSourceId: view.dataSourceId,
      status: view.status,
      ...this.viewConfiguration(view),
    });
  }

  private publicationResponse(
    view: View,
    snapshot: ViewSnapshot,
  ): PublicationResult {
    return {
      id: view.id,
      slug: view.slug,
      status: view.status,
      publishedAt: view.lastPublishedAt,
      snapshot: {
        id: snapshot.id,
        versionNo: Number(snapshot.versionNo),
        rowCount: snapshot.rowCount,
        fetchedAt: snapshot.fetchedAt,
      },
      url: '/v/' + view.slug,
    };
  }
}
