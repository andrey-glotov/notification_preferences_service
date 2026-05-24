import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { BasicAuthGuard } from '../auth/basic-auth.guard';
import { ObservabilityContextService } from '../observability/observability-context.service';
import { CreateInternalUserDto, InternalUserParamsDto } from './dto/create-internal-user.dto';
import { InternalUserEnvelope, toInternalUserResponse } from './dto/internal-user.response';
import { InternalEndpointGuard } from './internal-endpoint.guard';
import { UsersService } from './users.service';

@Controller('internal/:ecosystemCode/users')
@UseGuards(InternalEndpointGuard, BasicAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly observabilityContextService: ObservabilityContextService,
  ) {}

  @Post()
  async createInternalUser(
    @Param() params: InternalUserParamsDto,
    @Body() body: CreateInternalUserDto,
  ): Promise<InternalUserEnvelope> {
    const user = await this.usersService.createOrUpdateInternalUser({
      ecosystemCode: params.ecosystemCode,
      userId: body.userId,
      ...('region' in body ? { region: body.region ?? null } : {}),
    });

    return {
      data: toInternalUserResponse(user),
      requestId: this.observabilityContextService.getRequestId(),
    };
  }
}
