import {
  applyCellEdit,
  gridEditRevision,
} from '../../google-sheets/grid/grid-edit-state';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, type EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import { View } from '../views/entities/view.entity';
import { DataSource as Source } from '../data-sources/entities/data-source.entity';
import { SourceSheet } from '../source-sheets/entities/source-sheet.entity';
import { CellChangeLog } from './entities/cell-change-log.entity';
import { ViewAccessPolicy } from '../view-permissions/view-access.policy';
import { GoogleConnectionsService } from '../google-connections/google-connections.service';
import { sourceGoogleAccess } from '../../google-sheets/google-source-access';
import { GoogleSheetsService } from '../../google-sheets/google-sheets.service';
import {
  GoogleSheetsWriter,
  type SourceTextWrite,
} from '../../google-sheets/google-sheets.writer';
import { googleErrorStatus } from '../../google-sheets/google-sheets-request.executor';
import { SourceOperationLock } from '../../google-sheets/source-operation-lock';
import {
  ChangeStatusEnum,
  SelectionTypeEnum,
  ViewStatusEnum,
} from '../../common/enums/database.enums';
import { SubmitCellChangesDto } from './dto/submit-cell-changes.dto';
import { ViewsService } from '../views/views.service';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const configuration = (view: View, source: Source) =>
  digest({
    source: view.dataSourceId,
    sheet: view.sourceSheetId,
    selection: view.selectionType,
    range: view.rangeA1Notation,
    header: view.useFirstRowAsHeader,
    connection: sourceGoogleAccess(source)?.connectionId,
  });

@Injectable()
export class CellChangeLogsService {
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly policy: ViewAccessPolicy,
    private readonly connections: GoogleConnectionsService,
    private readonly sheets: GoogleSheetsService,
    private readonly writer: GoogleSheetsWriter,
    private readonly locks: SourceOperationLock,
    private readonly views: ViewsService,
    private readonly config: ConfigService,
  ) {}

  /** Queue timestamps and changed_at must use the same clock across workers. */
  private async databaseNow(manager: EntityManager = this.database.manager) {
    const [clock] = await manager.query<Array<{ milliseconds: string }>>(
      'SELECT extract(epoch FROM clock_timestamp()) * 1000 AS milliseconds',
    );
    return Math.floor(Number(clock.milliseconds));
  }

  private enabled() {
    if (this.config.get<string>('SHEET2WEB_WRITE_ENABLED') !== 'true')
      throw new ServiceUnavailableException(
        'Tính năng sửa dữ liệu chưa được bật.',
      );
  }
  private async source(userId: string, viewId: string) {
    this.enabled();
    const view = await this.database.manager.findOne(View, {
      where: { id: viewId, deletedAt: IsNull() },
    });
    if (!view) throw new NotFoundException('Không tìm thấy trang dữ liệu.');
    await this.policy.requireEditor(view, userId);
    const source = await this.database.manager.findOne(Source, {
      where: {
        id: view.dataSourceId,
        ownerId: view.ownerId,
        deletedAt: IsNull(),
      },
    });
    if (!source?.spreadsheetId)
      throw new ConflictException('Nguồn dữ liệu không còn hoạt động.');
    const access = sourceGoogleAccess(source);
    if (!access)
      throw new BadRequestException(
        'Chủ nguồn cần kết nối Google tại Nguồn dữ liệu trước khi cho phép sửa.',
      );
    const connection = await this.connections.findActive(access);
    if (!view.sourceSheetId || view.selectionType === SelectionTypeEnum.TABLE)
      throw new ConflictException('Vùng dữ liệu này chưa thể chỉnh sửa.');
    const tab = await this.database.manager.findOne(SourceSheet, {
      where: { id: view.sourceSheetId, dataSourceId: source.id },
    });
    if (!tab || tab.isHidden)
      throw new ConflictException('Tab này chưa thể chỉnh sửa.');
    return { view, source, access, tab, connection };
  }
  private async context(userId: string, viewId: string) {
    const context = await this.source(userId, viewId);
    const grid = await this.sheets.getGridSnapshot({
      spreadsheetId: context.source.spreadsheetId!,
      googleSheetId: context.tab.googleSheetId,
      sheetName: context.tab.sheetName,
      rangeA1Notation:
        context.view.selectionType === SelectionTypeEnum.RANGE
          ? context.view.rangeA1Notation!
          : undefined,
      useFirstRowAsHeader: context.view.useFirstRowAsHeader,
      googleAccess: context.access,
      includeEditState: true,
    });
    if (!grid.editState)
      throw new ConflictException('Chưa thể xác nhận các ô được phép sửa.');
    return { ...context, grid, editState: grid.editState };
  }
  async publicContext(userId: string, viewId: string) {
    const context = await this.context(userId, viewId);
    return {
      revision: context.editState.revision,
      cells: context.editState.cells.map(
        ({ row, column, value, valueType }) => ({
          row,
          column,
          ...(valueType === 'number' ? { value } : {}),
        }),
      ),
      grid: {
        headers: context.grid.headers,
        rows: context.grid.rows,
        rowCount: context.grid.rowCount,
        gridLayout: context.grid.gridLayout,
      },
      saveDelaySeconds: 5,
    };
  }
  async submit(userId: string, viewId: string, dto: SubmitCellChangesDto) {
    if (Buffer.byteLength(JSON.stringify(dto)) > 128 * 1024)
      throw new BadRequestException(
        'Mỗi lần lưu tối đa 128 KB. Hãy chia nhỏ nội dung.',
      );
    const context = await this.source(userId, viewId);
    if (
      new Set(dto.changes.map((c) => `${c.row}:${c.column}`)).size !==
      dto.changes.length
    )
      throw new BadRequestException(
        'Một ô không được xuất hiện hai lần trong cùng lượt lưu.',
      );
    const requestHash = digest({
      viewId,
      userId,
      revision: dto.baseRevision,
      changes: dto.changes,
    });
    try {
      await this.database.transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`sheet2web:batch:${dto.batchId}`],
        );
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`sheet2web:editor:${userId}`],
        );
        const existing = await manager.find(CellChangeLog, {
          where: { batchId: dto.batchId },
        });
        if (existing.length) {
          if (
            existing.some(
              (c) =>
                c.changedBy !== userId ||
                c.viewId !== viewId ||
                c.metadataJson.requestHash !== requestHash,
            )
          )
            throw new ConflictException(
              'Mã lượt lưu đã được dùng cho thay đổi khác.',
            );
          return;
        }
        const queued = await manager.count(CellChangeLog, {
          where: { changedBy: userId, requestStatus: ChangeStatusEnum.PENDING },
        });
        if (queued + dto.changes.length > 500)
          throw new HttpException(
            'Bạn có nhiều thay đổi đang chờ. Hãy đợi lưu xong trước khi tiếp tục.',
            429,
          );
        const now = await this.databaseNow(manager);
        const rows = dto.changes.map((change) =>
          manager.create(CellChangeLog, {
            viewId,
            sourceSheetId: context.tab.id,
            changedBy: userId,
            batchId: dto.batchId,
            rowIndex: change.row,
            columnIndex: change.column,
            cellAddress: `display:${change.row}:${change.column}`,
            newValue: change.value,
            sourceRevision: dto.baseRevision,
            requestStatus: ChangeStatusEnum.PENDING,
            metadataJson: {
              requestHash,
              configuration: configuration(context.view, context.source),
              spreadsheetId: context.source.spreadsheetId,
              connectionId: context.access.connectionId,
              connectionVersion: context.connection.updatedAt.toISOString(),
              attempts: 0,
              nextAttemptAt: now + 5000,
            },
          }),
        );
        await manager.save(CellChangeLog, rows);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Database errors can contain SQL parameters, including private cell text.
      throw new ServiceUnavailableException(
        'Chưa thể tiếp nhận lượt lưu. Hãy thử lại với cùng nội dung.',
      );
    }
    return this.status(userId, viewId, dto.batchId);
  }
  async status(userId: string, viewId: string, batchId: string) {
    const logs = await this.database.manager
      .createQueryBuilder(CellChangeLog, 'change')
      .select('change.request_status', 'requestStatus')
      .addSelect('change.error_message', 'errorMessage')
      .addSelect("change.metadata_json ->> 'nextAttemptAt'", 'nextAttemptAt')
      .addSelect('extract(epoch FROM clock_timestamp()) * 1000', 'databaseNow')
      .where(
        'change.view_id = :viewId AND change.batch_id = :batchId AND change.changed_by = :userId',
        { viewId, batchId, userId },
      )
      .getRawMany<{
        requestStatus: ChangeStatusEnum;
        errorMessage: string | null;
        nextAttemptAt: string | null;
        databaseNow: string;
      }>();
    if (!logs.length) throw new NotFoundException('Không tìm thấy lượt lưu.');
    const pending = logs.some(
      (log) => log.requestStatus === ChangeStatusEnum.PENDING,
    );
    const failed = logs.find(
      (log) =>
        log.requestStatus === ChangeStatusEnum.ERROR ||
        log.requestStatus === ChangeStatusEnum.CANCELLED,
    );
    const wait = Math.min(
      ...logs.map((log) =>
        Math.max(
          2,
          Math.ceil(
            (Number(log.nextAttemptAt ?? 0) - Number(log.databaseNow)) / 1000,
          ),
        ),
      ),
    );
    const recovery = failed
      ? await this.database.manager.find(CellChangeLog, {
          select: { rowIndex: true, columnIndex: true, newValue: true },
          where: { viewId, batchId, changedBy: userId },
        })
      : [];
    return {
      batchId,
      status: pending ? 'pending' : failed ? 'error' : 'applied',
      message: failed?.errorMessage ?? null,
      retryAfterSeconds: pending ? Math.min(15, wait) : null,
      ...(failed
        ? {
            changes: recovery.map((log) => ({
              row: log.rowIndex,
              column: log.columnIndex,
              value: log.newValue ?? '',
            })),
          }
        : {}),
    };
  }
  private async update(
    logs: CellChangeLog[],
    status: ChangeStatusEnum,
    error?: string,
  ) {
    await this.database.manager.update(
      CellChangeLog,
      {
        id: In(logs.map((log) => log.id)),
        requestStatus: ChangeStatusEnum.PENDING,
      },
      {
        requestStatus: status,
        errorMessage: error ?? null,
        ...(status === ChangeStatusEnum.APPLIED
          ? { appliedAt: () => 'clock_timestamp()' }
          : {}),
      },
    );
  }
  async flush() {
    this.enabled();
    const now = await this.databaseNow();
    const recent = this.database.manager
      .createQueryBuilder(CellChangeLog, 'applied')
      .select('1')
      .where(
        "applied.metadata_json ->> 'spreadsheetId' = change.metadata_json ->> 'spreadsheetId'",
      )
      .andWhere('applied.applied_at > :cutoff');
    const oldest = this.database.manager
      .createQueryBuilder(CellChangeLog, 'change')
      .select('change.batch_id', 'batchId')
      .addSelect('change.changed_at', 'changedAt')
      .addSelect(
        "COALESCE((change.metadata_json ->> 'nextAttemptAt')::bigint,0)",
        'nextAttemptAt',
      )
      .distinctOn(["change.metadata_json ->> 'spreadsheetId'"])
      .where('change.request_status = :pending', {
        pending: ChangeStatusEnum.PENDING,
      })
      .andWhere('change.batch_id IS NOT NULL')
      .andWhere("change.metadata_json ->> 'spreadsheetId' IS NOT NULL")
      .andWhere(`NOT EXISTS (${recent.getQuery()})`, {
        cutoff: new Date(now - 5000),
      })
      .orderBy("change.metadata_json ->> 'spreadsheetId'", 'ASC')
      .addOrderBy('change.changed_at', 'ASC');
    // Select the oldest batch per source before applying backoff. A later edit must not pass an uncertain write.
    const due = await this.database.manager
      .createQueryBuilder()
      .select('batch."batchId"', 'batchId')
      .from(`(${oldest.getQuery()})`, 'batch')
      .setParameters(oldest.getParameters())
      .where('batch."nextAttemptAt" <= :now', { now })
      .orderBy('batch."changedAt"', 'ASC')
      .limit(10)
      .getRawMany<{ batchId: string }>();
    for (const group of due) {
      // Fetch the whole batch: a queue limit must never create a partial write.
      const complete = await this.database.manager.find(CellChangeLog, {
        where: {
          batchId: group.batchId,
          requestStatus: ChangeStatusEnum.PENDING,
        },
      });
      await this.process(complete);
    }
  }
  private async process(logs: CellChangeLog[]) {
    if (!logs.length) return;
    let first = logs[0];
    const spreadsheetId = first.metadataJson.spreadsheetId as string;
    const affected: Array<{ ownerId: string; id: string }> = [];
    try {
      await this.locks.run(spreadsheetId, async () => {
        try {
          const current = await this.database.manager.find(CellChangeLog, {
            where: {
              batchId: first.batchId!,
              requestStatus: ChangeStatusEnum.PENDING,
            },
          });
          if (!current.length) return;
          logs = current;
          first = logs[0];
          const now = await this.databaseNow();
          if (now - first.changedAt.getTime() > 15 * 60 * 1000) {
            await this.update(
              logs,
              ChangeStatusEnum.ERROR,
              'Lượt lưu đã chờ quá lâu. Hãy tải lại Google Sheets và đối chiếu nội dung trước khi gửi lại.',
            );
            return;
          }
          const recent = await this.database.manager
            .createQueryBuilder(CellChangeLog, 'change')
            .where(
              "change.metadata_json ->> 'spreadsheetId' = :spreadsheetId",
              {
                spreadsheetId,
              },
            )
            .andWhere('change.applied_at > :cutoff', {
              cutoff: new Date(now - 5000),
            })
            .getExists();
          if (recent) return;
          const context = await this.context(first.changedBy!, first.viewId);
          if (
            context.connection.updatedAt.toISOString() !==
              first.metadataJson.connectionVersion ||
            context.source.spreadsheetId !== spreadsheetId ||
            configuration(context.view, context.source) !==
              first.metadataJson.configuration
          )
            throw new ConflictException(
              'Cấu hình nguồn đã thay đổi. Hãy tải lại dữ liệu trước khi sửa tiếp.',
            );
          if (first.metadataJson.writeUncertain) {
            if (
              context.editState.revision === first.metadataJson.expectedRevision
            ) {
              await this.update(logs, ChangeStatusEnum.APPLIED);
              affected.push({
                ownerId: context.view.ownerId,
                id: context.view.id,
              });
              return;
            }
            throw new ConflictException(
              'Chưa xác nhận được kết quả ghi vào Google Sheets. Hãy tải lại và kiểm tra nội dung trước khi lưu lại.',
            );
          }
          if (context.editState.revision !== first.sourceRevision)
            throw new ConflictException(
              'Dữ liệu Google Sheets đã thay đổi. Nội dung của bạn vẫn được giữ; hãy tải bản mới để đối chiếu.',
            );
          const writes: SourceTextWrite[] = [];
          const nextCells = context.editState.cells.map((cell) => ({
            ...cell,
          }));
          for (const log of logs) {
            const cell = nextCells.find(
              (c) => c.row === log.rowIndex && c.column === log.columnIndex,
            );
            if (!cell)
              throw new ForbiddenException(
                'Một ô không còn được phép sửa. Ô ẩn, công thức, dữ liệu có kiểu và vùng bảo vệ được giữ chỉ đọc.',
              );
            log.oldValue = cell.value;
            log.cellAddress = `R${cell.sourceRow + 1}C${cell.sourceColumn + 1}`;
            Object.assign(cell, applyCellEdit(cell, log.newValue ?? ''));
            writes.push({
              sheetId: context.grid.gridLayout.sheetId,
              row: cell.sourceRow,
              column: cell.sourceColumn,
              value:
                cell.valueType === 'number' ? Number(cell.value) : cell.value,
            });
          }
          const latest = await this.source(first.changedBy!, first.viewId);
          if (
            latest.connection.updatedAt.toISOString() !==
              first.metadataJson.connectionVersion ||
            configuration(latest.view, latest.source) !==
              first.metadataJson.configuration
          )
            throw new ConflictException(
              'Cấu hình nguồn đã thay đổi trong lúc kiểm tra. Hãy tải lại trước khi lưu.',
            );
          const expectedRevision = gridEditRevision(
            context.grid.gridLayout,
            nextCells,
            context.editState.readOnlyHash,
          );
          for (const log of logs)
            log.metadataJson = {
              ...log.metadataJson,
              writeUncertain: true,
              expectedRevision,
            };
          await this.database.manager.save(CellChangeLog, logs);
          await this.writer.write(context.access, spreadsheetId, writes);
          await this.update(logs, ChangeStatusEnum.APPLIED);
          const sources = await this.database.manager.find(Source, {
            where: { spreadsheetId, deletedAt: IsNull() },
          });
          const pages = await this.database.manager.find(View, {
            where: {
              dataSourceId: In(sources.map((s) => s.id)),
              status: ViewStatusEnum.PUBLISHED,
              deletedAt: IsNull(),
            },
          });
          affected.push(
            ...pages.map((page) => ({ ownerId: page.ownerId, id: page.id })),
          );
        } catch (error) {
          await this.failPending(logs, error);
        }
      });
    } catch (error) {
      // A worker that did not acquire the lock must never overwrite another worker's result.
      if (!(error instanceof ConflictException)) throw error;
    }
    for (const page of affected) {
      try {
        await this.views.publish(page.ownerId, page.id, 'background');
      } catch {
        /* Existing background synchronization retries snapshot capture. */
      }
    }
  }
  private async failPending(previous: CellChangeLog[], error: unknown) {
    const logs = await this.database.manager.find(CellChangeLog, {
      where: {
        id: In(previous.map((log) => log.id)),
        requestStatus: ChangeStatusEnum.PENDING,
      },
    });
    if (!logs.length) return;
    const first = logs[0];
    const code =
      error instanceof HttpException
        ? error.getStatus()
        : googleErrorStatus(error);
    const attempts = Number(first.metadataJson.attempts ?? 0) + 1;
    if ((code === 429 || code === 503 || code === undefined) && attempts <= 5) {
      const now = await this.databaseNow();
      for (const log of logs)
        log.metadataJson = {
          ...log.metadataJson,
          attempts,
          nextAttemptAt: now + Math.min(60000, 2000 * 2 ** attempts),
          ...(code === 429 ? { writeUncertain: false } : {}),
        };
      await this.database.manager.save(CellChangeLog, logs);
    } else {
      const message =
        error instanceof HttpException && code !== 403
          ? error.message
          : code === 403
            ? 'Không có quyền sửa ô hoặc Google Sheet này. Chủ nguồn cần kiểm tra quyền Google và quyền sửa trên trang.'
            : 'Chưa thể lưu thay đổi. Hãy tải lại và kiểm tra Google Sheets trước khi thử lại.';
      await this.update(logs, ChangeStatusEnum.ERROR, message);
    }
  }
}
