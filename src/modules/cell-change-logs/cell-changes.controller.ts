import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { CellChangeLogsService } from './cell-change-logs.service';
import { SubmitCellChangesDto } from './dto/submit-cell-changes.dto';

type EditorRequest = { user: { id: string } };
@Controller('views/:viewId')
export class CellChangesController {
  constructor(private readonly changes: CellChangeLogsService) {}
  @Get('edit-context') context(
    @Req() request: EditorRequest,
    @Param('viewId', ParseUUIDPipe) viewId: string,
  ) {
    return this.changes.publicContext(request.user.id, viewId);
  }
  @Post('cell-changes') submit(
    @Req() request: EditorRequest,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Body() dto: SubmitCellChangesDto,
  ) {
    return this.changes.submit(request.user.id, viewId, dto);
  }
  @Get('cell-changes/:batchId') status(
    @Req() request: EditorRequest,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return this.changes.status(request.user.id, viewId, batchId);
  }
}
