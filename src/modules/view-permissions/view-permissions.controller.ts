import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ViewPermissionsService } from './view-permissions.service';
import { UpdateViewPermissionDto } from './dto/update-view-permission.dto';
import { CreateViewPermissionDto } from './dto/create-view-permission.dto';
import { JwtAuthGuard } from '../../auth/passport/jwt-auth.guard';

@ApiTags('Quyền truy cập view')
@ApiBearerAuth()
@Controller('views/:viewId/permissions')
@UseGuards(JwtAuthGuard)
export class ViewPermissionsController {
  constructor(
    private readonly viewPermissionsService: ViewPermissionsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Cấp quyền truy cập view',
    description: 'Cấp quyền cho người dùng truy cập view.',
  })
  @ApiParam({ name: 'viewId', description: 'UUID của view.', format: 'uuid' })
  @ApiBody({ type: CreateViewPermissionDto })
  @ApiCreatedResponse({ description: 'Tạo quyền truy cập view thành công.' })
  @ApiBadRequestResponse({
    description: 'ID view hoặc dữ liệu gửi lên không hợp lệ.',
  })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({
    description: 'Không tìm thấy view hoặc người dùng đích.',
  })
  create(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'viewId',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    viewId: string,
    @Body() createViewPermissionDto: CreateViewPermissionDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewPermissionsService.create(
      userId,
      viewId,
      createViewPermissionDto,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Danh sách quyền truy cập view',
    description: 'Liệt kê người dùng có quyền truy cập view.',
  })
  @ApiParam({ name: 'viewId', description: 'UUID của view.', format: 'uuid' })
  @ApiOkResponse({
    description: 'Trả về danh sách quyền truy cập view thành công.',
  })
  @ApiBadRequestResponse({ description: 'ID view không hợp lệ.' })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy view.' })
  findAll(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'viewId',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    viewId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewPermissionsService.findAll(userId, viewId);
  }

  @Patch(':permissionId')
  updateRole(
    @Req() req: Request & { user: { id: string } },
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Body() dto: UpdateViewPermissionDto,
  ) {
    return this.viewPermissionsService.updateRole(
      req.user.id,
      viewId,
      permissionId,
      dto.role,
    );
  }

  @Delete(':permissionId')
  @ApiOperation({
    summary: 'Xóa quyền truy cập view',
    description: 'Xóa một quyền truy cập khỏi view.',
  })
  @ApiParam({ name: 'viewId', description: 'UUID của view.', format: 'uuid' })
  @ApiParam({
    name: 'permissionId',
    description: 'UUID của quyền truy cập view.',
    format: 'uuid',
  })
  @ApiNoContentResponse({
    description: 'Xóa quyền truy cập view thành công.',
  })
  @ApiOkResponse({ description: 'Trả về kết quả xóa thành công.' })
  @ApiBadRequestResponse({
    description: 'ID view hoặc ID quyền truy cập không hợp lệ.',
  })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy quyền truy cập view.' })
  remove(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'viewId',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    viewId: string,
    @Param(
      'permissionId',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng permission id'),
      }),
    )
    permissionId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewPermissionsService.remove(userId, viewId, permissionId);
  }
}
