import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { IsNull, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm/dist/common/typeorm.decorators';
import { hashPassword } from '../../helpers/utils';
import {
  CheckCodeDto,
  CreateAuthDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from '../../auth/dto/create-auth.dto';
import { UserStatusEnum } from '../../common/enums/database.enums';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly mailerService: MailerService,
  ) {}

  async checkEmailExists(email: string) {
    return await this.usersRepository.findOneBy({ email });
  }

  async create(createUserDto: CreateUserDto) {
    const hashedPassword = await hashPassword(createUserDto.passwordHash);
    createUserDto.passwordHash = hashedPassword;

    if (await this.checkEmailExists(createUserDto.email)) {
      throw new BadRequestException('Email đã tồn tại');
    }
    const user = this.usersRepository.create(createUserDto);
    return this.usersRepository.save(user);
  }

  findAll() {
    return this.usersRepository.find();
  }

  async findOneByEmail(email: string) {
    return await this.usersRepository.findOneBy({ email, deletedAt: IsNull() });
  }

  findActiveById(id: string) {
    return this.usersRepository.findOneBy({
      id,
      deletedAt: IsNull(),
      status: UserStatusEnum.ACTIVE,
    });
  }

  findOne(id: string) {
    return this.usersRepository.findOneBy({ id });
  }

  async findProfile(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy user');
    }

    return this.toProfileResponse(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const changes = { ...updateUserDto };
    if (!Object.keys(changes).length) {
      const user = await this.usersRepository.findOneBy({
        id,
        deletedAt: IsNull(),
      });
      if (!user) throw new NotFoundException('Không tìm thấy user');
      return user;
    }
    if (changes.passwordHash !== undefined) {
      if (
        typeof changes.passwordHash !== 'string' ||
        !changes.passwordHash.trim()
      ) {
        throw new BadRequestException('Mật khẩu không được để trống.');
      }
      changes.passwordHash = await hashPassword(changes.passwordHash);
    }

    const result = await this.usersRepository.update(
      { id, deletedAt: IsNull() },
      changes,
    );
    if (!result.affected) throw new NotFoundException('Không tìm thấy user');
    return this.usersRepository.findOneBy({ id, deletedAt: IsNull() });
  }

  async remove(id: string) {
    const user = await this.usersRepository.findOneBy({ id });

    if (!user) {
      throw new NotFoundException('Không tìm thấy user');
    }

    user.deletedAt = new Date();
    return await this.usersRepository.save(user);
  }

  async handleRegister(registerDto: CreateAuthDto) {
    if (await this.checkEmailExists(registerDto.email)) {
      throw new BadRequestException('Email đã tồn tại');
    }

    const hashedPassword = await hashPassword(registerDto.passwordHash);
    const codeId = uuidv4();
    const user = this.usersRepository.create({
      email: registerDto.email,
      passwordHash: hashedPassword,
      fullName: registerDto.fullName,
      status: UserStatusEnum.INACTIVE,
      codeId: codeId,
      createdAt: dayjs().toDate(),
      updatedAt: dayjs().toDate(),
      codeExpired: dayjs().add(5, 'minutes').toDate(),
    });

    const savedUser = await this.usersRepository.save(user);
    this.mailerService.sendMail({
      to: savedUser.email,
      subject: 'Activate your account',
      template: 'register.hbs',
      context: {
        name: savedUser?.fullName ?? savedUser.email,
        activationCode: codeId,
      },
    });

    return {
      id: savedUser.id,
      email: savedUser.email,
    };
  }

  async checkCode(checkCodeDto: CheckCodeDto) {
    const user = await this.usersRepository.findOneBy({
      id: checkCodeDto.id,
    });

    if (!user) {
      throw new NotFoundException('ID không hợp lệ');
    }

    if (!user.codeId || !user.codeExpired) {
      throw new BadRequestException(
        'Mã code không tồn tại, vui lòng đăng ký lại',
      );
    }

    if (user.status === UserStatusEnum.ACTIVE) {
      throw new BadRequestException('Tài khoản đã được kích hoạt trước đó');
    }

    if (user.codeId !== checkCodeDto.code) {
      throw new BadRequestException(
        'Mã code không đúng, vui lòng kiểm tra lại',
      );
    }

    if (dayjs().isAfter(dayjs(user.codeExpired))) {
      throw new BadRequestException(
        'Mã của bạn đã hết hạn, vui lòng đăng ký lại',
      );
    }

    user.status = UserStatusEnum.ACTIVE;
    user.codeId = null;
    user.codeExpired = null;

    await this.usersRepository.save(user);
    return {
      message: 'Xác minh tài khoản thành công',
    };
  }

  async retryActivation(body: { email: string }) {
    const user = await this.usersRepository.findOneBy({
      email: body.email,
    });

    if (!user) {
      throw new BadRequestException('Email không tồn tại.');
    }

    if (user.status === UserStatusEnum.ACTIVE) {
      throw new BadRequestException('Tài khoản đã được kích hoạt.');
    }

    const code = uuidv4();
    const codeExpired = dayjs().add(5, 'minutes').toDate();

    user.codeId = code;
    user.codeExpired = codeExpired;

    await this.usersRepository.save(user);

    this.mailerService.sendMail({
      to: user.email,
      subject: 'Activate your account',
      template: 'register.hbs',
      context: {
        name: user?.fullName ?? user.email,
        activationCode: code,
      },
    });

    return {
      id: user.id,
      email: user.email,
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.usersRepository.findOneBy({
      email: forgotPasswordDto.email,
    });

    if (!user) {
      throw new BadRequestException('Email không tồn tại.');
    }

    if (user.status !== UserStatusEnum.ACTIVE) {
      throw new BadRequestException('Tài khoản chưa được kích hoạt.');
    }

    const code = uuidv4();
    user.codeId = code;
    user.codeExpired = dayjs().add(5, 'minutes').toDate();

    await this.usersRepository.save(user);

    this.mailerService.sendMail({
      to: user.email,
      subject: 'Reset your password',
      template: 'forgot-password.hbs',
      context: {
        name: user?.fullName ?? user.email,
        resetCode: code,
      },
    });

    return {
      id: user.id,
      email: user.email,
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const user = await this.usersRepository.findOneBy({
      id: resetPasswordDto.id,
    });

    if (!user) {
      throw new NotFoundException('ID không hợp lệ');
    }

    if (!user.codeId || !user.codeExpired) {
      throw new BadRequestException(
        'Mã code không tồn tại, vui lòng gửi lại email',
      );
    }

    if (user.codeId !== resetPasswordDto.code) {
      throw new BadRequestException(
        'Mã code không đúng, vui lòng kiểm tra lại',
      );
    }

    if (dayjs().isAfter(dayjs(user.codeExpired))) {
      throw new BadRequestException(
        'Mã của bạn đã hết hạn, vui lòng gửi lại email',
      );
    }

    user.passwordHash = await hashPassword(resetPasswordDto.passwordHash);
    user.codeId = null;
    user.codeExpired = null;
    user.updatedAt = dayjs().toDate();

    await this.usersRepository.save(user);

    return {
      message: 'Đặt lại mật khẩu thành công',
    };
  }

  private toProfileResponse(user: User) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
