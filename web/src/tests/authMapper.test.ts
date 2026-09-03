import { describe, expect, it } from 'vitest';
import { mapAuthSession, mapAuthUser, toRegisterBody, toUpdateProfileBody } from '../auth/mapper';

describe('auth mapper', () => {
  it('normalizes snake_case backend fields to camelCase', () => {
    const user = mapAuthUser({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'bang@example.com',
      display_name: 'Bang',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(user).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'bang@example.com',
      displayName: 'Bang',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(user).not.toHaveProperty('display_name');
    expect(user).not.toHaveProperty('created_at');
  });

  it('maps roles, capabilities, and permissions from /v1/me', () => {
    const user = mapAuthUser({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'bang@example.com',
      display_name: 'Bang',
      roles: ['admin'],
      capabilities: { catalog_admin: true, admin: true },
      permissions: ['catalog.read', 'catalog.write', 'users.roles'],
    });
    expect(user.roles).toEqual(['admin']);
    expect(user.capabilities).toEqual({ catalog_admin: true, admin: true });
    expect(user.permissions).toEqual(['catalog.read', 'catalog.write', 'users.roles']);
  });

  it('maps session tokens without exposing refresh tokens', () => {
    const session = mapAuthSession({
      access_token: 'access',
      token_type: 'Bearer',
      expires_in: 900,
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'bang@example.com',
        display_name: 'Bang',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(session.accessToken).toBe('access');
    expect(session.expiresIn).toBe(900);
    expect(session).not.toHaveProperty('refresh_token');
    expect(session).not.toHaveProperty('refreshToken');
  });

  it('sends backend field names on write', () => {
    expect(toRegisterBody({
      email: 'bang@example.com',
      password: 'correct-horse',
      displayName: 'Bang',
    })).toEqual({
      email: 'bang@example.com',
      password: 'correct-horse',
      display_name: 'Bang',
    });
    expect(toUpdateProfileBody('Bang')).toEqual({ display_name: 'Bang' });
  });
});
