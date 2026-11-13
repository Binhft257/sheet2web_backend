import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CellTextChangeDto {
  @IsInt() @Min(0) @Max(1999) row!: number;
  @IsInt() @Min(0) @Max(99) column!: number;
  @IsString() @MaxLength(10000) value!: string;
}
export class SubmitCellChangesDto {
  @IsUUID() batchId!: string;
  @Matches(/^[a-f0-9]{64}$/) baseRevision!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CellTextChangeDto)
  changes!: CellTextChangeDto[];
}
