import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';
import type { KnownRole } from './roles.js';

export interface UserRoleRow {
  user_id: string;
  role: KnownRole;
  granted_by: string | null;
  granted_at: Date | string;
}

export class RolesRepository {
  constructor(private readonly db: Queryable) {}

  async hasRole(userId: string, role: KnownRole): Promise<boolean> {
    const result = await query(
      this.db,
      'SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2',
      [userId, role],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async grant(userId: string, role: KnownRole, grantedBy: string | null): Promise<boolean> {
    const result = await query(this.db, `
      INSERT INTO user_roles (user_id, role, granted_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, role) DO NOTHING
    `, [userId, role, grantedBy]);
    return (result.rowCount ?? 0) > 0;
  }

  async revoke(userId: string, role: KnownRole): Promise<boolean> {
    const result = await query(
      this.db,
      'DELETE FROM user_roles WHERE user_id = $1 AND role = $2',
      [userId, role],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listForUser(userId: string): Promise<UserRoleRow[]> {
    const result = await query<UserRoleRow>(
      this.db,
      'SELECT user_id, role, granted_by, granted_at FROM user_roles WHERE user_id = $1',
      [userId],
    );
    return result.rows;
  }
}
