import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class GoogleTokenCipher {
  constructor(private readonly config: ConfigService) {}
  isConfigured(): boolean {
    const value = this.config.get<string>('GOOGLE_TOKEN_ENCRYPTION_KEY');
    return Boolean(value && Buffer.from(value, 'base64').length === 32);
  }
  private key(): Buffer {
    if (!this.isConfigured())
      throw new ServiceUnavailableException(
        'Kết nối Google chưa được cấu hình.',
      );
    return Buffer.from(
      this.config.getOrThrow<string>('GOOGLE_TOKEN_ENCRYPTION_KEY'),
      'base64',
    );
  }
  encrypt(value: string, purpose: 'token' | 'state'): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(`sheet2web:google:${purpose}:v1`));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');
  }
  decrypt(value: string, purpose: 'token' | 'state'): string {
    const [version, iv, tag, data, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !data || extra)
      throw new Error('Invalid encrypted value');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(iv, 'base64url'),
    );
    cipher.setAAD(Buffer.from(`sheet2web:google:${purpose}:v1`));
    cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      cipher.update(Buffer.from(data, 'base64url')),
      cipher.final(),
    ]).toString('utf8');
  }
}
