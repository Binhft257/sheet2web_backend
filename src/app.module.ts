import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/users/users.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceTablesModule } from './modules/source-tables/source-tables.module';
import { ViewsModule } from './modules/views/views.module';
import { ViewSnapshotsModule } from './modules/view-snapshots/view-snapshots.module';
import { ViewPermissionsModule } from './modules/view-permissions/view-permissions.module';
import { SyncHistoriesModule } from './modules/sync-histories/sync-histories.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { CellChangeLogsModule } from './modules/cell-change-logs/cell-change-logs.module';
import { DataSourcesModule } from './modules/data-sources/data-sources.module';
import { ShareTokensModule } from './modules/share-tokens/share-tokens.module';
import { SourceSheetsModule } from './modules/source-sheets/source-sheets.module';
import { ThemesModule } from './modules/themes/themes.module';
import { AuthModule } from './auth/auth.module';
import { ViewerModule } from './modules/viewer/viewer.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/passport/jwt-auth.guard';
import { RolesGuard } from './auth/passport/roles.guard';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';

@Module({
  imports: [
    UsersModule,
    SourceTablesModule,
    SyncHistoriesModule,
    ViewPermissionsModule,
    ViewSnapshotsModule,
    ViewsModule,
    AuditLogsModule,
    CellChangeLogsModule,
    DataSourcesModule,
    ShareTokensModule,
    SourceSheetsModule,
    ThemesModule,
    ViewerModule,
    AuthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST'),
          port: config.get('MAIL_PORT'),
          secure: true,
          auth: {
            user: config.get<string>('MAIL_USER'),
            pass: config.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: config.get('MAIL_FROM'),
        },
        template: {
          dir: __dirname + '/mail/templates',
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
