import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { BasicAuthGuard } from '../auth/basic-auth.guard';
import { ObservabilityContextService } from '../observability/observability-context.service';
import { UpdateUserPreferencesDto, UserPreferencesParamsDto } from './dto/update-user-preferences.dto';
import {
  toUpdateUserPreferencesResponse,
  UpdateUserPreferencesEnvelope,
} from './dto/update-user-preferences.response';
import {
  toUserPreferencesResponse,
  UserPreferencesEnvelope,
} from './dto/user-preferences.response';
import { PreferencesService } from './preferences.service';

@Controller('api/:ecosystemCode/users/:userId/preferences')
@UseGuards(BasicAuthGuard)
export class PreferencesController {
  constructor(
    private readonly preferencesService: PreferencesService,
    private readonly observabilityContextService: ObservabilityContextService,
  ) {}

  @Get()
  async getUserPreferences(@Param() params: UserPreferencesParamsDto): Promise<UserPreferencesEnvelope> {
    const preferences = await this.preferencesService.getUserPreferences({
      ecosystemCode: params.ecosystemCode,
      userId: params.userId,
    });

    return {
      data: toUserPreferencesResponse(preferences),
      requestId: this.observabilityContextService.getRequestId(),
    };
  }

  @Post()
  async updateUserPreferences(
    @Param() params: UserPreferencesParamsDto,
    @Body() body: UpdateUserPreferencesDto,
  ): Promise<UpdateUserPreferencesEnvelope> {
    const updated = await this.preferencesService.updateUserPreferences({
      ecosystemCode: params.ecosystemCode,
      userId: params.userId,
      ...('preferences' in body ? { preferences: body.preferences } : {}),
      ...('quietHours' in body ? { quietHours: body.quietHours } : {}),
    });

    return {
      data: toUpdateUserPreferencesResponse(updated),
      requestId: this.observabilityContextService.getRequestId(),
    };
  }
}
