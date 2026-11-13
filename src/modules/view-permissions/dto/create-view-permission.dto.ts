import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class CreateViewPermissionDto {
  @IsOptional() @IsIn(['viewer', 'editor']) role?: 'viewer' | 'editor';

  @ApiProperty({
    example: 'viewer@example.com',
    description: 'Địa chỉ email được cấp quyền truy cập view.',
  })
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}
