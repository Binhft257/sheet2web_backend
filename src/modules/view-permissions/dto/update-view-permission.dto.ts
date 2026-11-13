import { IsIn } from 'class-validator';

export class UpdateViewPermissionDto {
  @IsIn(['viewer', 'editor']) role!: 'viewer' | 'editor';
}
