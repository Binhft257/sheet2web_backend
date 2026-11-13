import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { GoogleConnectionsService } from './google-connections.service';

class CompleteGoogleConnectionDto {
  @IsString() @IsNotEmpty() @MaxLength(4096) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(4096) state!: string;
}
type OwnerRequest = { user: { id: string } };

@Controller('google-connections')
export class GoogleConnectionsController {
  constructor(private readonly connections: GoogleConnectionsService) {}
  @Get() list(@Req() request: OwnerRequest) {
    return this.connections.list(request.user.id);
  }
  @Post('authorize') authorize(@Req() request: OwnerRequest) {
    return this.connections.authorize(request.user.id);
  }
  @Post('callback') callback(
    @Req() request: OwnerRequest,
    @Body() dto: CompleteGoogleConnectionDto,
  ) {
    return this.connections.complete(request.user.id, dto.code, dto.state);
  }
  @Delete(':id') disconnect(
    @Req() request: OwnerRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.connections.disconnect(request.user.id, id);
  }
}
