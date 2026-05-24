import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

export type BasicAuthCredentials = {
  username: string;
  password: string;
};

@Injectable()
export class BasicAuthService {
  private static readonly base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    const configuredCredentials = this.getConfiguredCredentials();

    return configuredCredentials.username.length > 0 && configuredCredentials.password.length > 0;
  }

  parseAuthorizationHeader(headerValue: unknown): BasicAuthCredentials | null {
    const authorization = this.getSingleHeaderValue(headerValue);

    if (authorization === null) {
      return null;
    }

    const parts = authorization.trim().split(/\s+/);

    if (parts.length !== 2 || parts[0].toLowerCase() !== 'basic' || parts[1].length === 0) {
      return null;
    }

    const decoded = this.decodeBase64(parts[1]);

    if (decoded === null) {
      return null;
    }

    const separatorIndex = decoded.indexOf(':');

    if (separatorIndex < 0) {
      return null;
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (username.length === 0 || password.length === 0) {
      return null;
    }

    return { username, password };
  }

  verifyCredentials(credentials: BasicAuthCredentials): boolean {
    const configuredCredentials = this.getConfiguredCredentials();
    const usernameMatches = this.constantTimeEquals(credentials.username, configuredCredentials.username);
    const passwordMatches = this.constantTimeEquals(credentials.password, configuredCredentials.password);

    return usernameMatches && passwordMatches;
  }

  private getConfiguredCredentials(): BasicAuthCredentials {
    return {
      username: this.configService.get<string>('auth.basicAuthUsername')?.trim() ?? '',
      password: this.configService.get<string>('auth.basicAuthPassword')?.trim() ?? '',
    };
  }

  private getSingleHeaderValue(headerValue: unknown): string | null {
    if (typeof headerValue === 'string') {
      return headerValue;
    }

    if (Array.isArray(headerValue) && headerValue.length === 1 && typeof headerValue[0] === 'string') {
      return headerValue[0];
    }

    return null;
  }

  private decodeBase64(token: string): string | null {
    const firstPaddingIndex = token.indexOf('=');

    if (
      token.length === 0 ||
      token.length % 4 !== 0 ||
      !BasicAuthService.base64Pattern.test(token) ||
      (firstPaddingIndex !== -1 && firstPaddingIndex < token.length - 2)
    ) {
      return null;
    }

    try {
      return Buffer.from(token, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  private constantTimeEquals(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualHash = createHash('sha256').update(actualBuffer).digest();
    const expectedHash = createHash('sha256').update(expectedBuffer).digest();

    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualHash, expectedHash);
  }
}
