import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { BasicAuthGuard } from '../auth/basic-auth.guard';
import { ObservabilityContextService } from '../observability/observability-context.service';
import { EvaluateNotificationDto, EvaluationParamsDto } from './dto/evaluate-notification.dto';
import {
  EvaluateNotificationEnvelope,
  toEvaluateNotificationResponse,
} from './dto/evaluate-notification.response';
import { EvaluationService } from './evaluation.service';

@Controller('api/:ecosystemCode/evaluate')
@UseGuards(BasicAuthGuard)
export class EvaluationController {
  constructor(
    private readonly evaluationService: EvaluationService,
    private readonly observabilityContextService: ObservabilityContextService,
  ) {}

  @Post()
  async evaluate(
    @Param() params: EvaluationParamsDto,
    @Body() body: EvaluateNotificationDto,
  ): Promise<EvaluateNotificationEnvelope> {
    const result = await this.evaluationService.evaluate({
      ecosystemCode: params.ecosystemCode,
      userId: body.userId,
      notificationType: body.notificationType,
      channel: body.channel,
      region: body.region,
      datetime: body.datetime,
    });

    return {
      data: toEvaluateNotificationResponse(result),
      requestId: this.observabilityContextService.getRequestId(),
    };
  }
}
