import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import { UsersService } from '../../modules/users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; role: UserRole }) {
    const user = await this.usersService.findActiveById(payload.sub);
    if (!user)
      throw new UnauthorizedException('Tài khoản không còn hoạt động.');
    return { id: user.id, email: user.email, role: user.role };
  }
}
