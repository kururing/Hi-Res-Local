import { afterEach, expect, it } from 'vitest';
import { hashRefreshToken } from '../../src/auth/tokens.js';
import { cookieHeader, describeIntegration, getIntegration, ORIGIN, refreshFrom, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('auth integration', handle, (ctx) => {

  afterEach(async () => {
    await resetIntegration();
  });

  const origin = ORIGIN;
  const cookieName = ctx.config.cookieName;

  async function register(
    email = 'Bang@Example.COM',
    password = 'correct-horse',
    displayName = 'Bang',
  ) {
    return ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin, 'content-type': 'application/json' },
      payload: { email, password, display_name: displayName },
    });
  }

  it('registers and logs in successfully with normalized email', async () => {
    const registered = await register();
    expect(registered.statusCode).toBe(201);
    const body = registered.json();
    expect(body.user.email).toBe('bang@example.com');
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe('Bearer');
    expect(body.user).not.toHaveProperty('password_hash');

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('bang@example.com');
    expect(me.json().display_name).toBe('Bang');
    expect(me.json().roles).toEqual([]);
    expect(me.json().capabilities).toEqual({ catalog_admin: false, admin: false });
    expect(me.json().permissions).toEqual(['catalog.read']);
    expect(body.user.capabilities).toEqual({ catalog_admin: false, admin: false });

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin, 'content-type': 'application/json' },
      payload: { email: '  bang@example.com ', password: 'correct-horse' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.id).toBe(body.user.id);
  });

  it('rejects duplicate email', async () => {
    expect((await register()).statusCode).toBe(201);
    const duplicate = await register('bang@example.com');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      code: 'AUTH_EMAIL_TAKEN',
      message: expect.any(String),
      request_id: expect.any(String),
    });
  });

  it('does not reveal whether an email exists on failed login', async () => {
    await register();
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin, 'content-type': 'application/json' },
      payload: { email: 'missing@example.com', password: 'correct-horse' },
    });
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin, 'content-type': 'application/json' },
      payload: { email: 'bang@example.com', password: 'wrong-password' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(wrong.json().code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(unknown.json().message).toBe(wrong.json().message);
  });

  it('rejects missing, invalid, and expired access tokens', async () => {
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me' });
    expect(me.statusCode).toBe(401);
    expect(me.json().code).toBe('AUTH_UNAUTHORIZED');

    const invalid = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().code).toBe('AUTH_TOKEN_INVALID');

    const now = Math.floor(Date.now() / 1000);
    const { SignJWT } = await import('jose');
    const expired = await new SignJWT({ sid: 'session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('11111111-1111-4111-8111-111111111111')
      .setIssuer(ctx.config.jwtIssuer)
      .setAudience(ctx.config.jwtAudience)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 10)
      .sign(new TextEncoder().encode(ctx.config.jwtSecret));
    const expiredRes = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(expiredRes.json().code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const registered = await register();
    const first = refreshFrom(registered, cookieName);

    const rotated = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: {
        origin,
        cookie: cookieHeader(cookieName, first),
      },
    });
    expect(rotated.statusCode).toBe(200);
    const second = refreshFrom(rotated, cookieName);
    expect(second).not.toBe(first);

    const reuse = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: {
        origin,
        cookie: cookieHeader(cookieName, first),
      },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('AUTH_REFRESH_REUSE');

    const afterReuse = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: {
        origin,
        cookie: cookieHeader(cookieName, second),
      },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('allows only one concurrent refresh-token rotation', async () => {
    const registered = await register('concurrent@example.com');
    const first = refreshFrom(registered, cookieName);
    const rotate = () => ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: {
        origin,
        cookie: cookieHeader(cookieName, first),
      },
    });

    const responses = await Promise.all([rotate(), rotate()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    expect(responses.find((response) => response.statusCode === 401)?.json().code).toBe('AUTH_REFRESH_REUSE');

    const children = await ctx.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM refresh_sessions
       WHERE parent_session_id = (
         SELECT id FROM refresh_sessions WHERE token_hash = $1
       )`,
      [hashRefreshToken(first)],
    );
    expect(children.rows[0]?.count).toBe(1);
  });

  it('revokes the current session on logout', async () => {
    const registered = await register();
    const token = refreshFrom(registered, cookieName);
    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: {
        origin,
        cookie: cookieHeader(cookieName, token),
      },
    });
    expect(logout.statusCode).toBe(204);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${registered.json().access_token}` },
    });
    expect(me.statusCode).toBe(401);

    const refresh = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: {
        origin,
        cookie: cookieHeader(cookieName, token),
      },
    });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json().code).toBe('AUTH_REFRESH_INVALID');
  });

  it('does not let user A read or mutate user B profile', async () => {
    const userA = (await register('a@example.com', 'correct-horse', 'User A')).json();
    const userB = (await register('b@example.com', 'correct-horse', 'User B')).json();

    const meA = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${userA.access_token}` },
    });
    expect(meA.json().id).toBe(userA.user.id);
    expect(meA.json().id).not.toBe(userB.user.id);
    expect(meA.json().email).toBe('a@example.com');

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: {
        authorization: `Bearer ${userA.access_token}`,
        'content-type': 'application/json',
      },
      payload: { display_name: 'Hijacked' },
    });
    expect(patch.json().id).toBe(userA.user.id);

    const meB = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${userB.access_token}` },
    });
    expect(meB.json().display_name).toBe('User B');
  });

  it('stores portable preferences with revision conflicts', async () => {
    const registered = await register();
    const authorization = `Bearer ${registered.json().access_token}`;

    const empty = await ctx.app.inject({
      url: '/v1/me/preferences',
      headers: { authorization },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ revision: 0, preferences: {} });

    const saved = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers: { authorization, 'content-type': 'application/json' },
      payload: {
        preferences: {
          language: 'en',
          streaming_quality: 'max',
          music_folders: ['C:\\Music'],
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().revision).toBe(1);
    expect(saved.json().preferences).toEqual({
      language: 'en',
    });

    const next = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers: { authorization, 'content-type': 'application/json' },
      payload: {
        revision: 1,
        preferences: { language: 'vi', output_device: 'wasapi' },
      },
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().revision).toBe(2);
    expect(next.json().preferences).toEqual({ language: 'vi' });

    const conflict = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers: { authorization, 'content-type': 'application/json' },
      payload: { revision: 1, preferences: { language: 'en' } },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('PREFERENCES_CONFLICT');
  });
});
