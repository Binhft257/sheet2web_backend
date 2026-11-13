import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CellChangeLogsService } from './cell-change-logs.service';

@Injectable()
export class CellChangeWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(CellChangeWorker.name);
  constructor(
    private readonly changes: CellChangeLogsService,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (this.config.get<string>('SHEET2WEB_WRITE_ENABLED') !== 'true') return;
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.changes.flush();
    } catch {
      this.logger.warn(
        'Chưa thể xử lý thay đổi ô. Các thay đổi đã nhận vẫn được lưu để thử lại.',
      );
    } finally {
      this.running = false;
    }
  }
}
