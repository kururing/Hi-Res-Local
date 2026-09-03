import { loadConfig } from '../src/config/env.js';
import { writeAdminAudit } from '../src/admin/audit.js';
import { UsersRepository } from '../src/auth/repository.js';
import { normalizeEmail } from '../src/auth/tokens.js';
import { parseFlagArgs } from '../src/cli/args.js';
import { createPool } from '../src/db/pool.js';
import { isKnownRole } from '../src/rbac/roles.js';
import { RolesRepository } from '../src/rbac/repository.js';

const args = parseFlagArgs(process.argv.slice(2));
const email = typeof args.email === 'string' ? normalizeEmail(args.email) : '';
const role = typeof args.role === 'string' ? args.role : '';

if (!email || !isKnownRole(role)) {
  console.error('Usage: npm run server:revoke-role -- -- --email user@example.test --role catalog_admin');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const user = await new UsersRepository(pool).findByNormalizedEmail(email);
  if (!user) {
    console.error(`No user found for ${email}.`);
    process.exitCode = 1;
    process.exit();
  }
  const revoked = await new RolesRepository(pool).revoke(user.id, role);
  await writeAdminAudit(pool, {
    adminUserId: null,
    action: revoked ? 'role.revoke' : 'role.revoke_idempotent',
    entityType: 'user',
    entityId: user.id,
    metadata: { email, role, source: 'cli' },
  });
  console.log(revoked
    ? `Revoked ${role} from ${email}.`
    : `${email} did not have ${role}.`);
} finally {
  await pool.end();
}
