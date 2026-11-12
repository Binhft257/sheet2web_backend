import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ViewsService } from './views.service';
import { CreateViewDto } from './dto/create-view.dto';
import { ListMyViewsQueryDto } from './dto/list-my-views-query.dto';
import { UpdateViewDto } from './dto/update-view.dto';
import { JwtAuthGuard } from '../../auth/passport/jwt-auth.guard';
import { Public } from '../../decorator/customize';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

@ApiTags('View')
@Controller('views')
export class ViewsController {
  constructor(private readonly viewsService: ViewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tạo view',
    description:
      'Tạo view từ nguồn dữ liệu đã kết nối cho người dùng đang đăng nhập.',
  })
  @ApiBody({ type: CreateViewDto })
  @ApiCreatedResponse({ description: 'Tạo view thành công.' })
  @ApiBadRequestResponse({ description: 'Dữ liệu view không hợp lệ.' })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  create(
    @Req() req: Request & { user?: { id?: string } },
    @Body() createViewDto: CreateViewDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewsService.create(userId, createViewDto);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sách view của tôi',
    description:
      'Trả về danh sách view có phân trang của người dùng đang đăng nhập.',
  })
  @ApiOkResponse({ description: 'Trả về danh sách view thành công.' })
  @ApiBadRequestResponse({ description: 'Tham số truy vấn không hợp lệ.' })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  findMyViews(
    @Req() req: Request & { user?: { id?: string } },
    @Query() listMyViewsQueryDto: ListMyViewsQueryDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewsService.listMy(userId, listMyViewsQueryDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy view theo ID',
    description: 'Trả về một view thuộc người dùng đang đăng nhập.',
  })
  @ApiParam({ name: 'id', description: 'UUID của view.', format: 'uuid' })
  @ApiOkResponse({ description: 'Trả về view thành công.' })
  @ApiBadRequestResponse({ description: 'ID view không hợp lệ.' })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy view.' })
  findOne(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewsService.findOne(userId, id);
  }

  @Patch(':id/published')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật view đã publish',
    description:
      'Cập nhật cấu hình hoặc nội dung đã publish của view thuộc người dùng đang đăng nhập.',
  })
  @ApiParam({ name: 'id', description: 'UUID của view.', format: 'uuid' })
  @ApiBody({ type: UpdateViewDto })
  @ApiOkResponse({ description: 'Cập nhật view đã publish thành công.' })
  @ApiBadRequestResponse({
    description: 'ID hoặc dữ liệu gửi lên không hợp lệ.',
  })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy view.' })
  updatePublished(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    id: string,
    @Body() updateViewDto: UpdateViewDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewsService.updatePublished(userId, id, updateViewDto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật view',
    description: 'Cập nhật view thuộc người dùng đang đăng nhập.',
  })
  @ApiParam({ name: 'id', description: 'UUID của view.', format: 'uuid' })
  @ApiBody({ type: UpdateViewDto })
  @ApiOkResponse({ description: 'Cập nhật view thành công.' })
  @ApiBadRequestResponse({
    description: 'ID hoặc dữ liệu gửi lên không hợp lệ.',
  })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy view.' })
  update(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    id: string,
    @Body() updateViewDto: UpdateViewDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewsService.update(userId, id, updateViewDto);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xuất bản view',
    description: 'Xuất bản một view nháp thuộc người dùng đang đăng nhập.',
  })
  @ApiParam({ name: 'id', description: 'UUID của view.', format: 'uuid' })
  @ApiOkResponse({ description: 'Xuất bản view thành công.' })
  @ApiBadRequestResponse({ description: 'ID view không hợp lệ.' })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy view.' })
  publish(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewsService.publish(userId, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xóa view',
    description: 'Xóa view thuộc người dùng đang đăng nhập.',
  })
  @ApiParam({ name: 'id', description: 'UUID của view.', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Xóa view thành công.' })
  @ApiOkResponse({ description: 'Trả về kết quả xóa thành công.' })
  @ApiBadRequestResponse({ description: 'ID view không hợp lệ.' })
  @ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai Bearer token.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy view.' })
  remove(
    @Req() req: Request & { user?: { id?: string } },
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException('Sai định dạng view id'),
      }),
    )
    id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Không xác định được người dùng đang đăng nhập',
      );
    }

    return this.viewsService.remove(userId, id);
  }
}

@ApiTags('View public')
@Controller('v')
export class PublicViewsController {
  constructor(
    private readonly viewsService: ViewsService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Get(':slug')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy view đã publish theo slug',
    description:
      'Trả về view đã publish theo slug. Bearer token là tùy chọn và có thể mở quyền truy cập riêng tư khi hợp lệ.',
  })
  @ApiParam({ name: 'slug', description: 'Slug của view đã publish.' })
  @ApiQuery({
    name: 'shareToken',
    required: false,
    description: 'Share token tùy chọn cho truy cập public có bảo vệ.',
  })
  @ApiOkResponse({ description: 'Trả về view đã publish thành công.' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy view đã publish.' })
  async findPublishedBySlug(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('shareToken') shareToken?: string,
  ) {
    const userId = await this.getOptionalUserId(req);
    return this.viewsService.findPublishedBySlug(slug, userId, shareToken);
  }

  private async getOptionalUserId(req: Request) {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      return undefined;
    }

    const accessToken = authorization.slice('Bearer '.length).trim();
    if (!accessToken) {
      return undefined;
    }

    try {
      const payload = await this.jwtService.verifyAsync<{ sub?: string }>(
        accessToken,
      );
      if (!payload.sub) return undefined;
      const user = await this.usersService.findActiveById(payload.sub);
      return user?.id;
    } catch {
      return undefined;
    }
  }
}
