import { CloudApiClient } from '../../api/client';
import {
  mapAuthSession,
  mapAuthUser,
  toLoginBody,
  toRegisterBody,
  toUpdateProfileBody,
  type AuthSessionResponseDto,
  type AuthUserDto,
} from '../../auth/mapper';
import type {
  AccountApi,
  AuthSessionResult,
  AuthUser,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from '../../auth/types';

export class WebAccountApi implements AccountApi {
  constructor(private readonly cloud: CloudApiClient) {}

  async register(request: RegisterRequest): Promise<AuthSessionResult> {
    const payload = await this.cloud.request<AuthSessionResponseDto>('/v1/auth/register', {
      method: 'POST',
      body: toRegisterBody(request),
    });
    return mapAuthSession(payload);
  }

  async login(request: LoginRequest): Promise<AuthSessionResult> {
    const payload = await this.cloud.request<AuthSessionResponseDto>('/v1/auth/login', {
      method: 'POST',
      body: toLoginBody(request),
    });
    return mapAuthSession(payload);
  }

  async refresh(): Promise<AuthSessionResult> {
    const payload = await this.cloud.request<AuthSessionResponseDto>('/v1/auth/refresh', {
      method: 'POST',
    });
    return mapAuthSession(payload);
  }

  async logout(): Promise<void> {
    await this.cloud.request<void>('/v1/auth/logout', {
      method: 'POST',
    });
  }

  async getProfile(): Promise<AuthUser> {
    const payload = await this.cloud.request<AuthUserDto>('/v1/me');
    return mapAuthUser(payload);
  }

  async updateProfile(request: UpdateProfileRequest): Promise<AuthUser> {
    const displayName = request.displayName?.trim();
    if (!displayName) {
      throw new Error('Display name is required.');
    }
    const payload = await this.cloud.request<AuthUserDto>('/v1/me', {
      method: 'PATCH',
      body: toUpdateProfileBody(displayName),
    });
    return mapAuthUser(payload);
  }

  async getPreferences() {
    return this.cloud.request<{
      schema_version: number;
      revision: number;
      preferences: Record<string, unknown>;
      updated_at: string;
    }>('/v1/me/preferences');
  }

  async putPreferences(input: { revision?: number; preferences: Record<string, unknown> }) {
    return this.cloud.request<{
      schema_version: number;
      revision: number;
      preferences: Record<string, unknown>;
      updated_at: string;
    }>('/v1/me/preferences', {
      method: 'PUT',
      body: input,
    });
  }
}
