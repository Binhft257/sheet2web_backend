import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateDataSourceDto } from './dto/create-data-source.dto';
import { ListDataSourcesQueryDto } from './dto/list-data-sources-query.dto';
import { PreviewDataSourceDto } from './dto/preview-data-source.dto';
import { UpdateDataSourceDto } from './dto/update-data-source.dto';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource as TypeOrmDataSource,
  EntityManager,
  IsNull,
  QueryFailedError,
} from 'typeorm';
import { DataSource as DataSourceEntity } from './entities/data-source.entity';
import { SourceSheet } from '../source-sheets/entities/source-sheet.entity';
import { View } from '../views/entities/view.entity';
import { ViewSnapshot } from '../view-snapshots/entities/view-snapshot.entity';
import {
  SourceStatusEnum,
  SourceTypeEnum,
  ViewStatusEnum,
} from '../../common/enums/database.enums';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';
import { extractSpreadsheetId } from './utils/extract-spreadsheet-id';
import { sourceGoogleAccess } from '../../google-sheets/google-source-access';
import { randomUUID } from 'node:crypto';
import {
  GoogleSheetTabMetadata,
  GoogleSheetsMetadata,
} from '../../google-sheets/types/google-sheets-metadata.type';
import { PREVIEW_MAX_ROWS } from './utils/sheet-range.util';

@Injectable()
export class DataSourcesService {
  constructor(
    @InjectDataSource()
    private readonly typeOrmDataSource: TypeOrmDataSource,
    private readonly googleSheetsService: GoogleSheetsService,
  ) {}

  async list(userId: string, listDataSourcesQueryDto: ListDataSourcesQueryDto) {
    const { page, limit, skip } = this.resolvePagination(
      listDataSourcesQueryDto.page,
      listDataSourcesQueryDto.limit,
    );
    const normalizedSearch = listDataSourcesQueryDto.search?.trim();

    const queryBuilder = this.typeOrmDataSource.manager
      .createQueryBuilder(DataSourceEntity, 'dataSource')
      .where('dataSource.owner_id = :userId', { userId })
      .andWhere('dataSource.deleted_at IS NULL');

    if (normalizedSearch) {
      queryBuilder.andWhere('dataSource.title ILIKE :search', {
        search: `%${normalizedSearch}%`,
      });
    }

    if (listDataSourcesQueryDto.status) {
      queryBuilder.andWhere('dataSource.source_status = :status', {
        status: listDataSourcesQueryDto.status,
      });
    }

    queryBuilder
      .orderBy('dataSource.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    const [dataSources, total] = await queryBuilder.getManyAndCount();

    const sheetCountByDataSourceId = new Map<string, number>();
    if (dataSources.length > 0) {
      const dataSourceIds = dataSources.map((dataSource) => dataSource.id);
      const countRows = await this.typeOrmDataSource.manager
        .createQueryBuilder(SourceSheet, 'sourceSheet')
        .select('sourceSheet.data_source_id', 'dataSourceId')
        .addSelect('COUNT(sourceSheet.id)', 'sheetCount')
        .where('sourceSheet.data_source_id IN (:...dataSourceIds)', {
          dataSourceIds,
        })
        .groupBy('sourceSheet.data_source_id')
        .getRawMany<{ dataSourceId: string; sheetCount: string }>();

      for (const countRow of countRows) {
        sheetCountByDataSourceId.set(
          countRow.dataSourceId,
          Number(countRow.sheetCount),
        );
      }
    }

    return {
      items: dataSources.map((dataSource) => ({
        id: dataSource.id,
        title: dataSource.title,
        googleConnectionId:
          sourceGoogleAccess(dataSource)?.connectionId ?? null,
        sourceType: dataSource.sourceType,
        sourceStatus: dataSource.sourceStatus,
        spreadsheetId: dataSource.spreadsheetId,
        sheetCount: sheetCountByDataSourceId.get(dataSource.id) ?? 0,
        lastSyncedStructureAt: dataSource.lastSyncedStructureAt,
        lastError: dataSource.lastError,
        createdAt: dataSource.createdAt,
        updatedAt: dataSource.updatedAt,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async listSheets(userId: string, dataSourceId: string) {
    const dataSource = await this.typeOrmDataSource.manager.findOne(
      DataSourceEntity,
      {
        where: {
          id: dataSourceId,
          deletedAt: IsNull(),
        },
      },
    );

    if (!dataSource) {
      throw new NotFoundException('Không tìm thấy data source');
    }

    if (dataSource.ownerId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập data source này.',
      );
    }

    const sourceSheets = await this.typeOrmDataSource.manager.find(
      SourceSheet,
      {
        where: { dataSourceId },
        order: { sortOrder: 'ASC' },
      },
    );

    return {
      dataSource: {
        id: dataSource.id,
        title: dataSource.title,
        sourceStatus: dataSource.sourceStatus,
      },
      sheets: sourceSheets.map((sourceSheet) => ({
        id: sourceSheet.id,
        sheetName: sourceSheet.sheetName,
        googleSheetId: sourceSheet.googleSheetId,
        gid: sourceSheet.gid,
        sortOrder: sourceSheet.sortOrder,
        isHidden: sourceSheet.isHidden,
        metadata: {
          rowCount: this.readMetadataNumber(
            sourceSheet.metadataJson,
            'rowCount',
          ),
          columnCount: this.readMetadataNumber(
            sourceSheet.metadataJson,
            'columnCount',
          ),
        },
      })),
    };
  }

  async create(userId: string, createDataSourceDto: CreateDataSourceDto) {
    const sourceUrl = createDataSourceDto.sourceUrl.trim();
    const spreadsheetId = extractSpreadsheetId(sourceUrl);
    const metadata = await this.googleSheetsService.getSpreadsheetMetadata(
      spreadsheetId,
      createDataSourceDto.googleConnectionId
        ? {
            ownerId: userId,
            connectionId: createDataSourceDto.googleConnectionId,
          }
        : undefined,
    );

    this.validateMetadataHasSheets(metadata);

    const normalizedTitle = createDataSourceDto.title?.trim();
    const resolvedTitle = normalizedTitle || metadata.spreadsheetTitle;

    try {
      return await this.typeOrmDataSource.transaction(async (manager) => {
        const dataSourceToCreate = manager.create(DataSourceEntity, {
          ownerId: userId,
          sourceType: SourceTypeEnum.GOOGLE_SHEET,
          sourceStatus: SourceStatusEnum.ACTIVE,
          sourceUrl,
          spreadsheetId,
          title: resolvedTitle,
          connectionMetaJson: {
            ...this.buildConnectionMeta(metadata),
            ...(createDataSourceDto.googleConnectionId
              ? { googleConnectionId: createDataSourceDto.googleConnectionId }
              : {}),
          },
          lastSyncedStructureAt: new Date(),
        });

        const savedDataSource = await manager.save(
          DataSourceEntity,
          dataSourceToCreate,
        );

        const sourceSheetsToCreate = metadata.sheets.map((sheet) =>
          manager.create(
            SourceSheet,
            this.buildSourceSheetData(savedDataSource.id, sheet),
          ),
        );

        const savedSourceSheets = await manager.save(
          SourceSheet,
          sourceSheetsToCreate,
        );

        return this.toResponse(savedDataSource, savedSourceSheets);
      });
    } catch (error) {
      this.throwIfDataSourceAlreadyExists(error);
      throw error;
    }
  }

  async update(
    userId: string,
    dataSourceId: string,
    updateDataSourceDto: UpdateDataSourceDto,
  ) {
    const original = await this.typeOrmDataSource.manager.findOne(
      DataSourceEntity,
      {
        where: { id: dataSourceId, deletedAt: IsNull() },
      },
    );
    if (!original) throw new NotFoundException('Không tìm thấy data source');
    if (original.ownerId !== userId)
      throw new ForbiddenException('Bạn không có quyền sửa data source này.');
    const expectedStructureTime =
      original.lastSyncedStructureAt?.getTime() ?? null;
    const incomingSourceUrl = updateDataSourceDto.sourceUrl;
    const hasSourceUrl = typeof incomingSourceUrl === 'string';
    const hasTitle = typeof updateDataSourceDto.title === 'string';

    let sourceUrl: string | undefined;
    let spreadsheetId: string | undefined;
    let metadata: GoogleSheetsMetadata | undefined;

    const connectionId =
      updateDataSourceDto.googleConnectionId === undefined
        ? sourceGoogleAccess(original)?.connectionId
        : updateDataSourceDto.googleConnectionId;
    if (hasSourceUrl || updateDataSourceDto.googleConnectionId !== undefined) {
      sourceUrl = hasSourceUrl ? incomingSourceUrl.trim() : original.sourceUrl;
      spreadsheetId = extractSpreadsheetId(sourceUrl);
      if (original.spreadsheetId && original.spreadsheetId !== spreadsheetId) {
        throw new ConflictException(
          'Không thể thay spreadsheet của nguồn hiện có vì có thể xóa các trang liên quan. Hãy thêm nguồn mới.',
        );
      }
      metadata = await this.googleSheetsService.getSpreadsheetMetadata(
        spreadsheetId,
        connectionId ? { ownerId: userId, connectionId } : undefined,
      );
      this.validateMetadataHasSheets(metadata);
    }

    try {
      return await this.typeOrmDataSource.transaction(async (manager) => {
        const dataSource = await manager.findOne(DataSourceEntity, {
          where: { id: dataSourceId, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });

        if (!dataSource) {
          throw new NotFoundException('Không tìm thấy data source');
        }

        if (dataSource.ownerId !== userId) {
          throw new ForbiddenException(
            'Bạn không có quyền sửa data source này.',
          );
        }

        if (
          metadata &&
          (sourceGoogleAccess(dataSource)?.connectionId !==
            sourceGoogleAccess(original)?.connectionId ||
            dataSource.spreadsheetId !== original.spreadsheetId ||
            (dataSource.lastSyncedStructureAt?.getTime() ?? null) !==
              expectedStructureTime)
        ) {
          throw new ConflictException(
            'Nguồn vừa được đồng bộ bởi yêu cầu khác. Vui lòng thử lại.',
          );
        }

        if (metadata && sourceUrl && spreadsheetId) {
          dataSource.sourceUrl = sourceUrl;
          dataSource.spreadsheetId = spreadsheetId;
          dataSource.connectionMetaJson = {
            ...dataSource.connectionMetaJson,
            ...this.buildConnectionMeta(metadata),
            googleConnectionId: connectionId ?? null,
          };
          dataSource.lastSyncedStructureAt = new Date();
        }

        if (hasTitle) {
          const normalizedTitle = updateDataSourceDto.title?.trim();
          dataSource.title =
            normalizedTitle ||
            metadata?.spreadsheetTitle ||
            dataSource.title ||
            null;
        }

        const savedDataSource = await manager.save(
          DataSourceEntity,
          dataSource,
        );

        let savedSourceSheets: SourceSheet[];
        if (metadata) {
          savedSourceSheets = await this.syncSourceSheetsWithMetadata(
            manager,
            savedDataSource.id,
            metadata,
          );
        } else {
          savedSourceSheets = await manager.find(SourceSheet, {
            where: { dataSourceId: savedDataSource.id },
            order: { sortOrder: 'ASC' },
          });
        }

        return this.toResponse(savedDataSource, savedSourceSheets);
      });
    } catch (error) {
      this.throwIfDataSourceAlreadyExists(error);
      throw error;
    }
  }

  async remove(userId: string, dataSourceId: string) {
    const dataSource = await this.typeOrmDataSource.manager.findOne(
      DataSourceEntity,
      {
        where: {
          id: dataSourceId,
          deletedAt: IsNull(),
        },
      },
    );

    if (!dataSource) {
      throw new NotFoundException('Không tìm thấy data source');
    }

    if (dataSource.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xóa data source này.');
    }

    const deletedAt = new Date();

    const deletedDataSource = await this.typeOrmDataSource.transaction(
      async (manager) => {
        const activeViews = await manager.find(View, {
          select: { id: true },
          where: {
            dataSourceId: dataSource.id,
            deletedAt: IsNull(),
          },
        });

        const viewIds = activeViews.map((view) => view.id);
        if (viewIds.length > 0) {
          await manager
            .createQueryBuilder()
            .update(ViewSnapshot)
            .set({
              isCurrent: false,
            })
            .where('view_id IN (:...viewIds)', { viewIds })
            .andWhere('is_current = true')
            .execute();
        }

        await manager
          .createQueryBuilder()
          .update(View)
          .set({
            deletedAt,
            status: ViewStatusEnum.ARCHIVED,
          })
          .where('data_source_id = :dataSourceId', {
            dataSourceId: dataSource.id,
          })
          .andWhere('deleted_at IS NULL')
          .execute();

        dataSource.deletedAt = deletedAt;
        dataSource.sourceStatus = SourceStatusEnum.DISCONNECTED;
        dataSource.lastError = null;

        return manager.save(DataSourceEntity, dataSource);
      },
    );

    return {
      id: deletedDataSource.id,
      sourceStatus: deletedDataSource.sourceStatus,
      deletedAt: deletedDataSource.deletedAt,
      deletedViews: true,
      deactivatedViewSnapshots: true,
    };
  }

  async preview(
    userId: string,
    dataSourceId: string,
    previewDataSourceDto: PreviewDataSourceDto,
  ) {
    const dataSource = await this.typeOrmDataSource.manager.findOne(
      DataSourceEntity,
      {
        where: {
          id: dataSourceId,
          deletedAt: IsNull(),
        },
      },
    );

    if (!dataSource) {
      throw new NotFoundException('Không tìm thấy nguồn dữ liệu.');
    }

    if (dataSource.ownerId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền preview nguồn dữ liệu này.',
      );
    }

    const sourceSheet = await this.typeOrmDataSource.manager.findOne(
      SourceSheet,
      {
        where: {
          id: previewDataSourceDto.sourceSheetId,
          dataSourceId: dataSourceId,
        },
      },
    );

    if (!sourceSheet) {
      throw new NotFoundException(
        'Không tìm thấy sheet trong nguồn dữ liệu này.',
      );
    }

    if (!dataSource.spreadsheetId) {
      throw new BadRequestException(
        'Nguồn dữ liệu không có spreadsheet id hợp lệ.',
      );
    }

    const normalizedRange = previewDataSourceDto.rangeA1Notation.trim();
    const result = await this.googleSheetsService.getGridSnapshot({
      spreadsheetId: dataSource.spreadsheetId,
      googleSheetId: sourceSheet.googleSheetId,
      sheetName: sourceSheet.sheetName,
      rangeA1Notation: normalizedRange || undefined,
      useFirstRowAsHeader: previewDataSourceDto.useFirstRowAsHeader ?? true,
      previewRows: PREVIEW_MAX_ROWS,
      ...(sourceGoogleAccess(dataSource)
        ? { googleAccess: sourceGoogleAccess(dataSource) }
        : {}),
    });
    return {
      dataSourceId: dataSource.id,
      sourceSheetId: sourceSheet.id,
      sheetName: result.sheetName,
      rangeA1Notation: normalizedRange,
      headers: result.headers,
      rows: result.rows,
      rowCount: result.rowCount,
      gridLayout: result.gridLayout,
      issues: result.issues,
      previewMeta: { truncated: result.truncated },
      previewedAt: new Date().toISOString(),
    };
  }

  private validateMetadataHasSheets(metadata: GoogleSheetsMetadata) {
    if (metadata.sheets.length === 0) {
      throw new BadRequestException(
        'Google Sheet không có sheet nào để đồng bộ',
      );
    }
    const ids = metadata.sheets.map((sheet) => sheet.googleSheetId);
    if (
      ids.some((id) => !Number.isSafeInteger(id) || id < 0) ||
      new Set(ids).size !== ids.length
    ) {
      throw new BadRequestException(
        'Metadata tab chưa hợp lệ. Không thực hiện đồng bộ hoặc xóa trang.',
      );
    }
  }

  private buildConnectionMeta(metadata: GoogleSheetsMetadata) {
    const connectionMetaJson: Record<string, unknown> = {
      spreadsheetTitle: metadata.spreadsheetTitle,
      sheetCount: metadata.sheets.length,
    };

    if (metadata.locale) {
      connectionMetaJson.locale = metadata.locale;
    }
    if (metadata.timeZone) {
      connectionMetaJson.timeZone = metadata.timeZone;
    }

    return connectionMetaJson;
  }

  private buildSourceSheetData(
    dataSourceId: string,
    sheet: GoogleSheetTabMetadata,
  ) {
    return {
      dataSourceId,
      sheetName: sheet.sheetName,
      googleSheetId: sheet.googleSheetId,
      gid: sheet.gid,
      sortOrder: sheet.sortOrder,
      isHidden: sheet.isHidden,
      metadataJson: sheet.metadataJson,
    };
  }

  private toResponse(
    dataSource: DataSourceEntity,
    sourceSheets: SourceSheet[],
  ) {
    return {
      id: dataSource.id,
      title: dataSource.title,
      googleConnectionId: sourceGoogleAccess(dataSource)?.connectionId ?? null,
      sourceType: dataSource.sourceType,
      sourceStatus: dataSource.sourceStatus,
      spreadsheetId: dataSource.spreadsheetId,
      sheets: sourceSheets.map((sourceSheet) => ({
        id: sourceSheet.id,
        sheetName: sourceSheet.sheetName,
        googleSheetId: sourceSheet.googleSheetId,
        gid: sourceSheet.gid,
        sortOrder: sourceSheet.sortOrder,
        isHidden: sourceSheet.isHidden,
      })),
    };
  }

  private throwIfDataSourceAlreadyExists(error: unknown) {
    if (!(error instanceof QueryFailedError)) {
      return;
    }

    const driverError = (
      error as QueryFailedError & {
        driverError?: {
          code?: string;
          constraint?: string;
          table?: string;
          detail?: string;
        };
      }
    ).driverError;

    if (driverError?.code !== '23505') {
      return;
    }

    const constraint = driverError.constraint?.toLowerCase() ?? '';
    const table = driverError.table?.toLowerCase() ?? '';
    const detail = driverError.detail?.toLowerCase() ?? '';

    const isDataSourceDuplicate =
      constraint === 'uq_data_sources_owner_source_spreadsheet_active' ||
      table === 'data_sources' ||
      constraint.includes('data_sources') ||
      detail.includes('data_sources') ||
      detail.includes('source_url') ||
      detail.includes('spreadsheet_id') ||
      detail.includes('owner_id');

    if (isDataSourceDuplicate) {
      throw new ConflictException('Data source này đã tồn tại');
    }
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

  private readMetadataNumber(
    metadata: Record<string, unknown> | undefined | null,
    key: 'rowCount' | 'columnCount',
  ) {
    const value = metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private async syncSourceSheetsWithMetadata(
    manager: EntityManager,
    dataSourceId: string,
    metadata: GoogleSheetsMetadata,
  ) {
    this.validateMetadataHasSheets(metadata);
    const sourceSheetPayloads = metadata.sheets.map((sheet) => ({
      ...this.buildSourceSheetData(dataSourceId, sheet),
      dataSourceId,
      metadataJson: sheet.metadataJson as Record<string, any>,
    }));

    const incomingGoogleSheetIds = sourceSheetPayloads
      .map((sheet) => sheet.googleSheetId)
      .filter(
        (googleSheetId): googleSheetId is number =>
          typeof googleSheetId === 'number',
      );

    // Only this owner-triggered transaction may remove confirmed absent tabs.
    // Remove first so a new tab can safely reuse a deleted tab's unique name.
    await manager
      .createQueryBuilder()
      .delete()
      .from(SourceSheet)
      .where('data_source_id = :dataSourceId', { dataSourceId })
      .andWhere(
        '(google_sheet_id IS NOT NULL AND google_sheet_id NOT IN (:...incomingGoogleSheetIds))',
        { incomingGoogleSheetIds },
      )
      .execute();

    const existing = await manager.find(SourceSheet, {
      where: { dataSourceId },
    });
    for (const sheet of existing) {
      const incoming = sourceSheetPayloads.find(
        (value) => value.googleSheetId === sheet.googleSheetId,
      );
      if (incoming && incoming.sheetName !== sheet.sheetName) {
        // Avoid unique-name conflicts when two stable tab IDs exchange names.
        await manager.update(
          SourceSheet,
          { id: sheet.id, dataSourceId },
          { sheetName: `__sheet2web_sync_${randomUUID()}` },
        );
      }
    }
    await manager.upsert(SourceSheet, sourceSheetPayloads, [
      'dataSourceId',
      'googleSheetId',
    ]);

    return manager.find(SourceSheet, {
      where: { dataSourceId },
      order: { sortOrder: 'ASC' },
    });
  }
}
