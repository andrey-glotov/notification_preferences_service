import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class InternalUserParamsDto {
  @IsString()
  @Length(1, 64)
  ecosystemCode!: string;
}

export class CreateInternalUserDto {
  @IsString()
  @Length(1, 128)
  userId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  region?: string | null;
}
