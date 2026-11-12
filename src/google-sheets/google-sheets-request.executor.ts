import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

export function googleErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown };
  };
  const status = candidate.response?.status ?? candidate.code;
  return typeof status === 'number' ? status : undefined;
}

/** One shared gate for metadata, grid, preview and legacy reads. */
@Injectable()
export class GoogleSheetsRequestExecutor {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly concurrency = 2;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.acquire();
      let failure: unknown;
      try {
        return await operation();
      } catch (error) {
        failure = error;
      } finally {
        this.release();
      }
      if (failure instanceof HttpException) throw failure;
      const status = googleErrorStatus(failure);
      if (status === 400 || status === 403 || status === 404) {
        throw new BadRequestException(
          'Không đọc được Google Sheets. Kiểm tra quyền truy cập, tab và phạm vi đã chọn.',
        );
      }
      const temporary =
        status === undefined ||
        status === 408 ||
        status === 429 ||
        status >= 500;
      if (!temporary || attempt === 2) {
        // Do not expose Google's response, request URL/API key, cell values or formulas.
        throw new ServiceUnavailableException(
          'Google Sheets tạm thời không khả dụng. Vui lòng thử lại sau.',
        );
      }
      await this.delay(250 * 2 ** attempt + Math.floor(Math.random() * 100));
    }
    throw new ServiceUnavailableException('Không thể đọc Google Sheets.');
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= 50)
      throw new ServiceUnavailableException(
        'Đang có nhiều yêu cầu đọc Google Sheets. Vui lòng thử lại.',
      );
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  protected delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
