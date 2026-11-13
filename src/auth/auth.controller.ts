import { Request, Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiProperty,
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './passport/local-auth.guard';
import { Public } from '../decorator/customize';
import type { User } from '../modules/users/entities/user.entity';
import type { Request as ExpressRequest } from 'express';
import {
  CheckCodeDto,
  CreateAuthDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/create-auth.dto';

class RetryActivationDto {
  @ApiProperty({
    example: 'owner@example.com',
    description: 'Địa chỉ email sẽ nhận mã kích hoạt mới.',
  })
  email!: string;
}

type AuthenticatedRequest = ExpressRequest & { user: User };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @UseGuards(LocalAuthGuard)
  @ApiOperation({
    summary: 'Đăng nhập',
    description: 'Xác thực bằng email và mật khẩu, sau đó trả về access token.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'passwordHash'],
      properties: {
        email: { type: 'string', example: 'owner@example.com' },
        passwordHash: { type: 'string', example: 'P@ssw0rd123' },
      },
    },
  })
  @ApiOkResponse({ description: 'Đăng nhập thành công.' })
  @ApiBadRequestResponse({ description: 'Dữ liệu đăng nhập không hợp lệ.' })
  async login(@Request() req: AuthenticatedRequest) {
    return this.authService.logIn(req.user);
  }

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Đăng ký',
    description: 'Tạo tài khoản mới và bắt đầu luồng kích hoạt tài khoản.',
  })
  @ApiBody({ type: CreateAuthDto })
  @ApiCreatedResponse({ description: 'Đăng ký tài khoản thành công.' })
  @ApiBadRequestResponse({ description: 'Dữ liệu đăng ký không hợp lệ.' })
  async register(@Body() registerDto: CreateAuthDto) {
    return await this.authService.handleRegister(registerDto);
  }

  @Public()
  @Post('check-code')
  @ApiOperation({
    summary: 'Kiểm tra mã kích hoạt',
    description: 'Xác minh mã kích hoạt hoặc mã xác nhận.',
  })
  @ApiBody({ type: CheckCodeDto })
  @ApiOkResponse({ description: 'Kiểm tra mã thành công.' })
  @ApiBadRequestResponse({ description: 'Dữ liệu mã xác minh không hợp lệ.' })
  async checkCode(@Body() checkCodeDto: CheckCodeDto) {
    return await this.authService.checkCode(checkCodeDto);
  }

  @Public()
  @Post('retry-active')
  @ApiOperation({
    summary: 'Gửi lại email kích hoạt',
    description: 'Gửi lại mã kích hoạt tài khoản tới email đã cung cấp.',
  })
  @ApiBody({ type: RetryActivationDto })
  @ApiOkResponse({ description: 'Đã xử lý yêu cầu gửi lại email kích hoạt.' })
  @ApiBadRequestResponse({ description: 'Dữ liệu email không hợp lệ.' })
  async retryActivation(@Body() email: { email: string }) {
    return await this.authService.retryActivation(email);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Quên mật khẩu',
    description: 'Yêu cầu gửi mã đặt lại mật khẩu qua email.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({ description: 'Đã xử lý yêu cầu đặt lại mật khẩu.' })
  @ApiBadRequestResponse({
    description: 'Dữ liệu quên mật khẩu không hợp lệ.',
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return await this.authService.forgotPassword(forgotPasswordDto);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({
    summary: 'Đặt lại mật khẩu',
    description: 'Đặt lại mật khẩu bằng mã xác minh hợp lệ.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ description: 'Đặt lại mật khẩu thành công.' })
  @ApiBadRequestResponse({
    description: 'Dữ liệu đặt lại mật khẩu không hợp lệ.',
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return await this.authService.resetPassword(resetPasswordDto);
  }
}
