import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateShareTokenDto } from './dto/create-share-token.dto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource as TypeOrmDataSource, IsNull } from 'typeorm';
import { View } from '../views/entities/view.entity';
import { ShareToken } from './entities/share-token.entity';
import {
  TokenStatusEnum,
  TokenTypeEnum,
} from '../../common/enums/database.enums';
import {
  createShareTokenPreview,
  generateShareToken,
  hashShareToken,
} from './utils/share-token.util';

@Injectable()
export class ShareTokensService {
  constructor(
    @InjectDataSource()
    private readonly typeOrmDataSource: TypeOrmDataSource,
  ) {}

  async create(
    userId: string,
    viewId: string,
    createShareTokenDto: CreateShareTokenDto,
  ) {
    const view = await this.findOwnedView(userId, viewId);
    const rawToken = generateShareToken();
    const name = createShareTokenDto.name?.trim() || null;

    const shareToken = this.typeOrmDataSource.manager.create(ShareToken, {
      viewId: view.id,
      tokenHash: hashShareToken(rawToken),
      tokenPreview: createShareTokenPreview(rawToken),
      tokenType: TokenTypeEnum.PUBLIC_SHARE,
      status: TokenStatusEnum.ACTIVE,
      expiresAt: createShareTokenDto.expiresAt
        ? new Date(createShareTokenDto.expiresAt)
        : null,
      createdBy: userId,
      metadataJson: name ? { name } : {},
    });

    const savedToken = await this.typeOrmDataSource.manager.save(
      ShareToken,
      shareToken,
    );

    return {
      id: savedToken.id,
      name,
      url: `/v/${view.slug}?shareToken=${rawToken}`,
      canCopy: true,
      isRevoked: false,
      expiresAt: savedToken.expiresAt,
      createdAt: savedToken.createdAt,
    };
  }

  async findAll(userId: string, viewId: string) {
    const view = await this.findOwnedView(userId, viewId);
    const shareTokens = await this.typeOrmDataSource.manager.find(ShareToken, {
      where: { viewId: view.id },
      order: { createdAt: 'DESC' },
    });

    return {
      items: shareTokens.map((shareToken) => this.toListResponse(shareToken)),
    };
  }

  async revoke(userId: string, viewId: string, tokenId: string) {
    const view = await this.findOwnedView(userId, viewId);
    const shareToken = await this.typeOrmDataSource.manager.findOne(
      ShareToken,
      {
        where: {
          id: tokenId,
          viewId: view.id,
        },
      },
    );

    if (!shareToken) {
      throw new NotFoundException('Không tìm thấy share token.');
    }

    shareToken.status = TokenStatusEnum.REVOKED;
    shareToken.revokedAt = new Date();
    const savedToken = await this.typeOrmDataSource.manager.save(
      ShareToken,
      shareToken,
    );

    return {
      id: savedToken.id,
      isRevoked: true,
      revokedAt: savedToken.revokedAt,
    };
  }

  private async findOwnedView(userId: string, viewId: string) {
    const view = await this.typeOrmDataSource.manager.findOne(View, {
      where: { id: viewId, deletedAt: IsNull() },
    });

    if (!view) {
      throw new NotFoundException('Không tìm thấy view.');
    }

    if (view.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền quản lý view này.');
    }

    return view;
  }

  private toListResponse(shareToken: ShareToken) {
    const name =
      typeof shareToken.metadataJson?.name === 'string'
        ? shareToken.metadataJson.name
        : null;

    return {
      id: shareToken.id,
      name,
      // Only the hash is stored. A masked preview must never be used as a URL.
      url: null,
      canCopy: false,
      tokenPreview: shareToken.tokenPreview ?? null,
      isRevoked: shareToken.status === TokenStatusEnum.REVOKED,
      expiresAt: shareToken.expiresAt,
      createdAt: shareToken.createdAt,
      revokedAt: shareToken.revokedAt,
      lastUsedAt: shareToken.lastUsedAt,
    };
  }
}
