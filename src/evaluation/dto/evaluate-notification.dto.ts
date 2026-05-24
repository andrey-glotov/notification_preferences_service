import {
  IsDefined,
  IsString,
  Length,
  Matches,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

const OFFSET_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function IsFutureOffsetDateTime(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isFutureOffsetDateTime',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !OFFSET_DATE_TIME_PATTERN.test(value)) {
            return false;
          }

          const timestamp = Date.parse(value);

          return Number.isFinite(timestamp) && timestamp > Date.now();
        },
      },
    });
  };
}

export class EvaluationParamsDto {
  @IsString()
  @Length(1, 64)
  ecosystemCode!: string;
}

export class EvaluateNotificationDto {
  @IsString()
  @Length(1, 128)
  userId!: string;

  @IsString()
  @Length(1, 64)
  notificationType!: string;

  @IsString()
  @Length(1, 64)
  channel!: string;

  @IsString()
  @Length(1, 32)
  region!: string;

  @IsDefined()
  @IsString()
  @Matches(OFFSET_DATE_TIME_PATTERN)
  @IsFutureOffsetDateTime({ message: 'datetime must be a future ISO date-time with timezone offset' })
  datetime!: string;
}
