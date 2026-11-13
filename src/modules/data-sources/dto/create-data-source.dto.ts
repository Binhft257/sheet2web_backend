import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDataSourceDto {
  @ApiPropertyOptional({
    description: 'Kết nối Google của chủ nguồn; bỏ trống để dùng nguồn public.',
  })
  @IsOptional()
  @IsUUID()
  googleConnectionId?: string | null;

  @ApiProperty({
    example: 'https://docs.google.com/spreadsheets/d/abc123/edit',
    description: 'URL Google Sheets dùng để kết nối làm nguồn dữ liệu.',
  })
  @IsNotEmpty()
  @IsString()
  sourceUrl!: string;

  @ApiPropertyOptional({
    example: 'Q2 Sales Sheet',
    description: 'Tiêu đề hiển thị của nguồn dữ liệu.',
  })
  @IsOptional()
  @IsString()
  title?: string;
}
