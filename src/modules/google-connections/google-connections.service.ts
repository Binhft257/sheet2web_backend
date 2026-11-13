import type { sheets_v4 } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { GoogleConnection } from './entities/google-connection.entity';
import { GoogleTokenCipher } from './google-token-cipher';
import {
  GoogleOAuthGateway,
  GOOGLE_SHEETS_SCOPE,
} from './google-oauth.gateway';

export type GoogleAccess = { ownerId: string; connectionId: string };

@Injectable()
export class GoogleConnectionsService {
  private readonly clients = new Map<
    string,
    { version: string; client: sheets_v4.Sheets }
  >();
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly cipher: GoogleTokenCipher,
    private readonly gateway: GoogleOAuthGateway,
  ) {}

  configured(): boolean {
    return (
      this.cipher.isConfigured() &&
      [
        'GOOGLE_OAUTH_CLIENT_ID',
        'GOOGLE_OAUTH_CLIENT_SECRET',
        'GOOGLE_OAUTH_REDIRECT_URI',
      ].every((key) => Boolean(this.config.get<string>(key)))
    );
  }
  private requireConfiguration() {
    if (!this.configured())
      throw new ServiceUnavailableException(
        'Kết nối Google chưa sẵn sàng. Vui lòng liên hệ quản trị viên.',
      );
  }
  private response(connection: GoogleConnection) {
    return {
      id: connection.id,
      email: connection.email,
      canWrite: connection.scopes.includes(GOOGLE_SHEETS_SCOPE),
      connected: !connection.revokedAt,
      createdAt: connection.createdAt,
    };
  }
  async list(ownerId: string) {
    if (!this.configured()) return { configured: false, items: [] };
    try {
      const connections = await this.database.manager.find(GoogleConnection, {
        where: { ownerId, revokedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
      return {
        configured: true,
        items: connections.map((connection) => this.response(connection)),
      };
    } catch (error) {
      if (
        (error as { driverError?: { code?: string } }).driverError?.code ===
        '42P01'
      )
        return { configured: false, setupRequired: true, items: [] };
      throw error;
    }
  }
  authorize(ownerId: string) {
    this.requireConfiguration();
    const verifier = randomBytes(48).toString('base64url');
    const state = this.cipher.encrypt(
      JSON.stringify({ ownerId, verifier, expiresAt: Date.now() + 600_000 }),
      'state',
    );
    return {
      url: this.gateway.createClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent select_account',
        scope: ['openid', 'email', GOOGLE_SHEETS_SCOPE],
        state,
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: CodeChallengeMethod.S256,
      }),
    };
  }
  async complete(ownerId: string, code: string, state: string) {
    this.requireConfiguration();
    let parsed: { ownerId: string; verifier: string; expiresAt: number };
    try {
      parsed = JSON.parse(this.cipher.decrypt(state, 'state')) as typeof parsed;
      if (
        parsed.ownerId !== ownerId ||
        !parsed.verifier ||
        parsed.expiresAt <= Date.now()
      )
        throw new Error('Expired or mismatched state');
    } catch {
      throw new BadRequestException(
        'Phiên kết nối Google đã hết hạn hoặc không hợp lệ. Hãy kết nối lại.',
      );
    }
    const client = this.gateway.createClient();
    let tokens: {
      refresh_token?: string | null;
      id_token?: string | null;
      scope?: string;
    };
    let identity: { sub: string; email: string };
    try {
      ({ tokens } = await client.getToken({
        code,
        codeVerifier: parsed.verifier,
      }));
      if (!tokens.id_token) throw new Error('Missing identity');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.getOrThrow<string>('GOOGLE_OAUTH_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || !payload.email_verified)
        throw new Error('Unverified identity');
      identity = { sub: payload.sub, email: payload.email };
    } catch {
      throw new BadRequestException(
        'Không thể xác nhận kết nối Google. Hãy thử kết nối lại.',
      );
    }
    const scopes = (tokens.scope ?? '').split(' ').filter(Boolean);
    if (!scopes.includes(GOOGLE_SHEETS_SCOPE))
      throw new BadRequestException(
        'Cần cho phép truy cập Google Sheets để kết nối nguồn.',
      );
    const existing = await this.database.manager
      .createQueryBuilder(GoogleConnection, 'connection')
      .addSelect('connection.encryptedRefreshToken')
      .where(
        'connection.owner_id = :ownerId AND connection.google_subject = :subject',
        { ownerId, subject: identity.sub },
      )
      .getOne();
    if (!tokens.refresh_token && (!existing || existing.revokedAt))
      throw new BadRequestException(
        'Google chưa cấp kết nối nền. Hãy kết nối lại và chấp thuận quyền truy cập.',
      );
    const saved = await this.database.manager.save(
      GoogleConnection,
      this.database.manager.create(GoogleConnection, {
        ...existing,
        ownerId,
        googleSubject: identity.sub,
        email: identity.email,
        encryptedRefreshToken: tokens.refresh_token
          ? this.cipher.encrypt(tokens.refresh_token, 'token')
          : existing!.encryptedRefreshToken,
        scopes,
        revokedAt: null,
      }),
    );
    return this.response(saved);
  }
  async findActive(access: GoogleAccess) {
    this.requireConfiguration();
    const connection = await this.database.manager.findOne(GoogleConnection, {
      where: {
        id: access.connectionId,
        ownerId: access.ownerId,
        revokedAt: IsNull(),
      },
    });
    if (!connection)
      throw new ForbiddenException(
        'Kết nối Google đã ngắt hoặc không thuộc chủ nguồn. Hãy kết nối lại.',
      );
    return connection;
  }
  async client(access: GoogleAccess) {
    const active = await this.findActive(access);
    const version = active.updatedAt.toISOString();
    const cached = this.clients.get(access.connectionId);
    if (cached?.version === version) {
      this.clients.delete(access.connectionId);
      this.clients.set(access.connectionId, cached);
      return cached.client;
    }
    const connection = await this.database.manager
      .createQueryBuilder(GoogleConnection, 'connection')
      .addSelect('connection.encryptedRefreshToken')
      .where(
        'connection.id = :id AND connection.owner_id = :ownerId AND connection.revoked_at IS NULL',
        { id: access.connectionId, ownerId: access.ownerId },
      )
      .getOne();
    if (!connection)
      throw new ForbiddenException('Kết nối Google không còn hiệu lực.');
    const client = this.gateway.createClient();
    try {
      client.setCredentials({
        refresh_token: this.cipher.decrypt(
          connection.encryptedRefreshToken,
          'token',
        ),
      });
    } catch {
      throw new ForbiddenException(
        'Không thể đọc kết nối Google. Chủ nguồn cần kết nối lại tài khoản.',
      );
    }
    const sheets = this.gateway.sheets(client);
    this.clients.set(access.connectionId, { version, client: sheets });
    if (this.clients.size > 100) {
      const oldest = Array.from(this.clients.keys())[0];
      if (oldest) this.clients.delete(oldest);
    }
    return sheets;
  }
  async disconnect(ownerId: string, id: string) {
    const result = await this.database.manager.update(
      GoogleConnection,
      { id, ownerId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected)
      throw new NotFoundException('Không tìm thấy kết nối Google.');
    return { success: true };
  }
}
