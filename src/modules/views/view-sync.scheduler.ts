import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { View } from './entities/view.entity';
import { ViewStatusEnum } from '../../common/enums/database.enums';
import { ViewsService } from './views.service';

/** In-process scheduler for the current single-instance MVP deployment. */
@Injectable()
export class ViewSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ViewSyncScheduler.name);
  private readonly dueAt = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly views: ViewsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('SHEET2WEB_SYNC_ENABLED') === 'false') return;
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const pages = await this.database.manager.find(View, {
        select: { id: true, ownerId: true, refreshIntervalSeconds: true },
        where: { status: ViewStatusEnum.PUBLISHED, deletedAt: IsNull() },
      });
      const active = new Set(pages.map((page) => page.id));
      for (const id of this.dueAt.keys())
        if (!active.has(id)) {
          this.dueAt.delete(id);
          this.failures.delete(id);
        }
      const now = Date.now();
      const due = pages
        .filter((page) => {
          if (!this.dueAt.has(page.id)) {
            let hash = 0;
            for (const letter of page.id)
              hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
            this.dueAt.set(page.id, now + (hash % this.interval(page)));
          }
          return this.dueAt.get(page.id)! <= now;
        })
        .sort((a, b) => this.dueAt.get(a.id)! - this.dueAt.get(b.id)!);
      let index = 0;
      const concurrency = this.numberSetting(
        'SHEET2WEB_SYNC_CONCURRENCY',
        2,
        1,
        4,
      );
      await Promise.all(
        Array.from({ length: Math.min(concurrency, due.length) }, async () => {
          while (index < due.length) {
            const page = due[index++];
            try {
              // No tab listing sync, deletion or cascading cleanup is invoked here.
              await this.views.publish(page.ownerId, page.id, 'background');
              this.failures.delete(page.id);
              this.dueAt.set(page.id, Date.now() + this.interval(page));
            } catch {
              const failures = (this.failures.get(page.id) ?? 0) + 1;
              this.failures.set(page.id, failures);
              const interval = this.interval(page);
              this.dueAt.set(
                page.id,
                Date.now() +
                  Math.max(
                    interval,
                    Math.min(interval * 2 ** Math.min(failures, 4), 300_000),
                  ),
              );
              this.logger.warn(
                `Đồng bộ trang ${page.id} thất bại; sẽ thử lại sau.`,
              );
            }
          }
        }),
      );
    } catch {
      this.logger.warn(
        'Không thể lập lịch đồng bộ. Sẽ thử lại ở chu kỳ kế tiếp.',
      );
    } finally {
      this.ticking = false;
    }
  }

  private interval(page: Pick<View, 'refreshIntervalSeconds'>): number {
    const minimum = this.numberSetting(
      'SHEET2WEB_MIN_SYNC_SECONDS',
      60,
      30,
      3600,
    );
    const fallback = this.numberSetting(
      'SHEET2WEB_DEFAULT_SYNC_SECONDS',
      60,
      minimum,
      86400,
    );
    const requested = Number(page.refreshIntervalSeconds);
    return (
      Math.max(
        minimum,
        Number.isFinite(requested) && requested > 0 ? requested : fallback,
      ) * 1000
    );
  }

  private numberSetting(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const value = Number(this.config.get<string | number>(name));
    return Number.isInteger(value) && value >= minimum && value <= maximum
      ? value
      : fallback;
  }
}
