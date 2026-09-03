import { CloudApiError } from '../api/client';
import type { AuthSessionResult, AuthUser } from './types';

export interface AuthUserDto {
  id: string;
  email: string;
  display_name: string;
  created_at?: string;
  updated_at?: string;
  roles?: string[];
  capabilities?: { catalog_admin?: boolean; admin?: boolean };
  permissions?: string[];
}

export interface AuthSessionResponseDto {
  access_token: string;
  token_type?: string;
  expires_in: number;
  user: AuthUserDto;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function mapAuthUser(dto: AuthUserDto): AuthUser {
  const user: AuthUser = {
    id: dto.id,
    email: dto.email,
    displayName: dto.display_name,
  };
  if (dto.created_at) user.createdAt = dto.created_at;
  if (dto.updated_at) user.updatedAt = dto.updated_at;
  if (Array.isArray(dto.roles)) user.roles = dto.roles;
  if (dto.capabilities) {
    user.capabilities = {
      catalog_admin: dto.capabilities.catalog_admin === true,
      admin: dto.capabilities.admin === true,
    };
  }
  if (Array.isArray(dto.permissions)) user.permissions = dto.permissions;
  return user;
}

export function mapAuthSession(dto: AuthSessionResponseDto): AuthSessionResult {
  if (!dto.access_token || typeof dto.expires_in !== 'number' || !dto.user) {
    throw new Error('Auth session response was missing required fields.');
  }
  return {
    accessToken: dto.access_token,
    expiresIn: dto.expires_in,
    user: mapAuthUser(dto.user),
  };
}

export function toRegisterBody(request: { email: string; password: string; displayName: string }) {
  return {
    email: request.email,
    password: request.password,
    display_name: request.displayName,
  };
}

export function toLoginBody(request: { email: string; password: string }) {
  return {
    email: request.email,
    password: request.password,
  };
}

export function toUpdateProfileBody(displayName: string) {
  return { display_name: displayName };
}

export function cloudErrorCode(error: unknown): string | undefined {
  if (!(error instanceof CloudApiError)) return undefined;
  if (error.code) return error.code;
  if (isRecord(error.details) && typeof error.details.code === 'string') {
    return error.details.code;
  }
  return undefined;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof CloudApiError && error.status === 401;
}

export function isAuthNetworkError(error: unknown): boolean {
  if (error instanceof CloudApiError) {
    return error.status === 0
      || error.status === 408
      || error.status === 429
      || error.status >= 500;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }
  if (error instanceof TypeError) return true;
  if (error instanceof Error && /failed to fetch|networkerror|load failed|network request failed/i.test(error.message)) {
    return true;
  }
  return false;
}
