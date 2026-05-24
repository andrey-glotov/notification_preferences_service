import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { databaseConfig } from '../config/database.config';
import { databaseProvider } from './database.provider';

@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [databaseProvider],
  exports: [databaseProvider],
})
export class DatabaseModule {}
