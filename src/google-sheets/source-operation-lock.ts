import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Serializes application writes and snapshot capture across every view of a spreadsheet. */
@Injectable()
export class SourceOperationLock {
  constructor(@InjectDataSource() private readonly database: DataSource) {}
  async run<T>(spreadsheetId: string, task: () => Promise<T>): Promise<T> {
    const runner = this.database.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const [result] = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        [`sheet2web:source:${spreadsheetId}`],
      )) as Array<{ acquired: boolean }>;
      locked = result.acquired;
      if (!locked)
        throw new ConflictException(
          'Nguồn đang được cập nhật. Vui lòng thử lại sau ít giây.',
        );
      return await task();
    } finally {
      try {
        if (locked)
          await runner.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [`sheet2web:source:${spreadsheetId}`],
          );
      } finally {
        await runner.release();
      }
    }
  }
}
