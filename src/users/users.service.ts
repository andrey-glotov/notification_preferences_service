import { Injectable } from '@nestjs/common';
import { ErrorService } from '../errors/error.service';
import { UsersRepository } from './users.repository';
import { InternalUser, UpsertInternalUserInput } from './users.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly errorService: ErrorService,
  ) {}

  async createOrUpdateInternalUser(input: UpsertInternalUserInput): Promise<InternalUser> {
    try {
      return await this.usersRepository.upsertInternalUser(input);
    } catch (error) {
      throw this.errorService.internal({
        message: 'Internal server error.',
        details: null,
        component: 'users',
        operation: 'upsert_internal_user',
        severity: 'error',
        retryable: false,
        cause: error,
      });
    }
  }
}
