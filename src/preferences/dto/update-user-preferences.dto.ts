import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  IsArray,
  IsBoolean,
  IsDefined,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function IsIanaTimezone(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isIanaTimezone',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') {
            return false;
          }

          try {
            new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
            return true;
          } catch {
            return false;
          }
        },
      },
    });
  };
}

function QuietHoursTimesDiffer(validationOptions?: ValidationOptions): ClassDecorator {
  return (target) => {
    registerDecorator({
      name: 'quietHoursTimesDiffer',
      target,
      propertyName: 'endTime',
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const quietHours = args.object as QuietHoursDto;

          return quietHours.startTime !== quietHours.endTime;
        },
      },
    });
  };
}

export class UserPreferencesParamsDto {
  @IsString()
  @Length(1, 64)
  ecosystemCode!: string;

  @IsString()
  @Length(1, 128)
  userId!: string;
}

export class PreferenceItemDto {
  @IsString()
  @Length(1, 64)
  notificationType!: string;

  @IsString()
  @Length(1, 64)
  channel!: string;

  @IsBoolean()
  allowed!: boolean;
}

@QuietHoursTimesDiffer({ message: 'startTime and endTime must be different' })
export class QuietHoursDto {
  @IsString()
  @Matches(HH_MM_PATTERN)
  startTime!: string;

  @IsString()
  @Matches(HH_MM_PATTERN)
  endTime!: string;

  @IsString()
  @Length(1, 64)
  @IsIanaTimezone({ message: 'timezone must be a valid IANA timezone' })
  timezone!: string;
}

export class UpdateUserPreferencesDto {
  @ValidateIf((body) => body.preferences === undefined && body.quietHours === undefined)
  @IsDefined({ message: 'preferences or quietHours must be provided' })
  private readonly updateTarget?: never;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  preferences?: PreferenceItemDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;
}
