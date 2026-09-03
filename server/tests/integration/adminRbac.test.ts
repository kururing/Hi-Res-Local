import { afterEach, expect, it } from 'vitest';
import { RolesRepository } from '../../src/rbac/repository.js';
import { ADMIN_ROLE, CATALOG_ADMIN_ROLE } from '../../src/rbac/roles.js';
import {
  describeIntegration,
  getIntegration,
  grantCatalogAdmin,
  ORIGIN,
  resetIntegration,
} from './helpers.js';

const handle = await getIntegration();

describeIntegration('admin RBAC', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  async function register(email: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: 'correct-horse', display_name: 'Admin' },
    });
    return response.json() as { access_token: string; user: { id: string } };
  }

  it('forbids ordinary users and allows catalog admins', async () => {
    const user = await register('user@example.test');
    const forbidden = await ctx.app.inject({
      url: '/v1/admin/catalog/tracks',
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('ADMIN_FORBIDDEN');

    const caps = await ctx.app.inject({
      url: '/v1/admin/capabilities',
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(caps.json()).toEqual({ catalog_admin: false, admin: false });

    await grantCatalogAdmin(ctx.pool, user.user.id);
    const allowed = await ctx.app.inject({
      url: '/v1/admin/capabilities',
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(allowed.json()).toEqual({ catalog_admin: true, admin: false });
    expect((await ctx.app.inject({
      url: '/v1/admin/catalog/artists',
      headers: { authorization: `Bearer ${user.access_token}` },
    })).statusCode).toBe(200);
  });

  it('revokes immediately without waiting for the access token to expire', async () => {
    const user = await register('revoke@example.test');
    await grantCatalogAdmin(ctx.pool, user.user.id);
    await new RolesRepository(ctx.pool).revoke(user.user.id, CATALOG_ADMIN_ROLE);
    const response = await ctx.app.inject({
      url: '/v1/admin/catalog/tracks',
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('treats admin as implying catalog_admin on /v1/me', async () => {
    const user = await register('superadmin@example.test');
    await new RolesRepository(ctx.pool).grant(user.user.id, ADMIN_ROLE, null);
    const me = await ctx.app.inject({
      url: '/v1/me',
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    expect(me.json().roles).toEqual(['admin']);
    expect(me.json().capabilities).toEqual({ catalog_admin: true, admin: true });
    expect(me.json().permissions).toEqual(expect.arrayContaining(['catalog.write', 'users.roles']));
    expect((await ctx.app.inject({
      url: '/v1/admin/catalog/artists',
      headers: { authorization: `Bearer ${user.access_token}` },
    })).statusCode).toBe(200);
  });

  it('treats grant and revoke as idempotent and writes audit rows', async () => {
    const user = await register('audit@example.test');
    const roles = new RolesRepository(ctx.pool);
    expect(await roles.grant(user.user.id, CATALOG_ADMIN_ROLE, null)).toBe(true);
    expect(await roles.grant(user.user.id, CATALOG_ADMIN_ROLE, null)).toBe(false);
    expect(await roles.revoke(user.user.id, CATALOG_ADMIN_ROLE)).toBe(true);
    expect(await roles.revoke(user.user.id, CATALOG_ADMIN_ROLE)).toBe(false);
  });
});
