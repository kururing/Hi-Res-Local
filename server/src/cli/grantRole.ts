import { writeAdminAudit } from '../admin/audit.js';
import { UsersRepository } from '../auth/repository.js';
import { normalizeEmail } from '../auth/tokens.js';
import { isKnownRole } from '../rbac/roles.js';
import { RolesRepository } from '../rbac/repository.js';
import type { Pool } from 'pg';

export async function grantRole(
  pool: Pool,
  emailRaw: string,
  role: string,
): Promise<{ granted: boolean; email: string }> {
  const email = normalizeEmail(emailRaw);
  if (!email || !isKnownRole(role)) {
    throw new Error('Usage requires --email and a known --role such as catalog_admin.');
  }
  const user = await new UsersRepository(pool).findByNormalizedEmail(email);
  if (!user) {
    throw new Error(`No user found for ${email}.`);
  }
  const granted = await new RolesRepository(pool).grant(user.id, role, null);
  await writeAdminAudit(pool, {
    adminUserId: null,
    action: granted ? 'role.grant' : 'role.grant_idempotent',
    entityType: 'user',
    entityId: user.id,
    metadata: { email, role, source: 'cli' },
  });
  return { granted, email };
}
