import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class PreviewDataSourceDto {
  @ApiProperty({
    example: '6a5ef874-243c-45fe-b293-39d550c05046',
    description: 'ID source sheet cần xem trước.',
  })
  @IsUUID()
  sourceSheetId!: string;

  @ApiProperty({
    example: 'A1:D20',
    description:
      'Range A1 không kèm tên tab; chuỗi rỗng để xem toàn bộ sheet. Preview dùng GridLayout v1 và có thể trả truncated.',
  })
  @IsString()
  rangeA1Notation!: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Cho biết có dùng dòng đầu tiên làm tiêu đề cột hay không.',
  })
  @IsOptional()
  @IsBoolean()
  useFirstRowAsHeader?: boolean;
}
