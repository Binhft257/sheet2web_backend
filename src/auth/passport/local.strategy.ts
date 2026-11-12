import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { UserStatusEnum } from '../../common/enums/database.enums';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'passwordHash',
    });
  }

  async validate(email: string, passwordHash: string) {
    const user = await this.authService.validateUser(email, passwordHash);
    if (user.status === UserStatusEnum.INACTIVE) {
      throw new BadRequestException('Tài khoản chưa được kích hoạt');
    }
    return user;
  }
}
