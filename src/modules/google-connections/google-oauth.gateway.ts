import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OAuth2Client } from 'google-auth-library';
import type { sheets_v4 } from 'googleapis';

export const GOOGLE_SHEETS_SCOPE =
  'https://www.googleapis.com/auth/spreadsheets';

@Injectable()
export class GoogleOAuthGateway {
  constructor(private readonly config: ConfigService) {}
  createClient(): OAuth2Client {
    // Keep googleapis lazy, as in the existing reader, to avoid loading its discovery types at startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Match the existing lazy Google reader to keep startup lightweight.
    const { google } = require('googleapis') as typeof import('googleapis');
    return new google.auth.OAuth2(
      this.config.getOrThrow<string>('GOOGLE_OAUTH_CLIENT_ID'),
      this.config.getOrThrow<string>('GOOGLE_OAUTH_CLIENT_SECRET'),
      this.config.getOrThrow<string>('GOOGLE_OAUTH_REDIRECT_URI'),
    );
  }
  sheets(client: OAuth2Client): sheets_v4.Sheets {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Match the existing lazy Google reader to keep startup lightweight.
    const { google } = require('googleapis') as typeof import('googleapis');
    return google.sheets({ version: 'v4', auth: client });
  }
}
