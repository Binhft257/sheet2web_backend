import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleConnection } from './entities/google-connection.entity';
import { GoogleConnectionsController } from './google-connections.controller';
import { GoogleConnectionsService } from './google-connections.service';
import { GoogleTokenCipher } from './google-token-cipher';
import { GoogleOAuthGateway } from './google-oauth.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([GoogleConnection])],
  controllers: [GoogleConnectionsController],
  providers: [GoogleConnectionsService, GoogleTokenCipher, GoogleOAuthGateway],
  exports: [GoogleConnectionsService],
})
export class GoogleConnectionsModule {}
