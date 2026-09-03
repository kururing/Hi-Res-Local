import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';

export interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ProfileRow {
  user_id: string;
  display_name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface UserWithProfile extends UserRow {
  display_name: string;
}

export interface RefreshSessionRow {
  id: string;
  user_id: string;
  family_id: string;
  parent_session_id: string | null;
  token_hash: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  reuse_detected_at: Date | string | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: Date | string;
}

export class UsersRepository {
  constructor(private readonly db: Queryable) {}

  async insertUser(
    id: string,
    email: string,
    emailNormalized: string,
    passwordHash: string,
    displayName: string,
  ): Promise<UserWithProfile> {
    await query(this.db, `
      INSERT INTO users (id, email, email_normalized, password_hash)
      VALUES ($1, $2, $3, $4)
    `, [id, email, emailNormalized, passwordHash]);
    await query(this.db, `
      INSERT INTO user_profiles (user_id, display_name)
      VALUES ($1, $2)
    `, [id, displayName]);
    const user = await this.findById(id);
    if (!user) throw new Error('User insert did not persist.');
    return user;
  }

  async findByNormalizedEmail(emailNormalized: string): Promise<UserRow | null> {
    const result = await query<UserRow>(
      this.db,
      'SELECT * FROM users WHERE email_normalized = $1',
      [emailNormalized],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserWithProfile | null> {
    const result = await query<UserWithProfile>(this.db, `
      SELECT u.*, p.display_name
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = $1
    `, [id]);
    return result.rows[0] ?? null;
  }

  async updateDisplayName(userId: string, displayName: string): Promise<UserWithProfile> {
    await query(this.db, `
      UPDATE user_profiles
      SET display_name = $2, updated_at = timezone('utc', now())
      WHERE user_id = $1
    `, [userId, displayName]);
    await query(this.db, `
      UPDATE users SET updated_at = timezone('utc', now()) WHERE id = $1
    `, [userId]);
    const user = await this.findById(userId);
    if (!user) throw new Error('User disappeared during profile update.');
    return user;
  }
}

export class AuthRepository {
  constructor(private readonly db: Queryable) {}

  async insertSession(input: {
    id: string;
    userId: string;
    familyId: string;
    parentSessionId: string | null;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<void> {
    await query(this.db, `
      INSERT INTO refresh_sessions (
        id, user_id, family_id, parent_session_id, token_hash, expires_at, user_agent, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      input.id,
      input.userId,
      input.familyId,
      input.parentSessionId,
      input.tokenHash,
      input.expiresAt.toISOString(),
      input.userAgent,
      input.ipAddress,
    ]);
  }

  async findActiveSession(sessionId: string, userId: string): Promise<RefreshSessionRow | null> {
    const result = await query<RefreshSessionRow>(
      this.db,
      `SELECT * FROM refresh_sessions
       WHERE id = $1
         AND user_id = $2
         AND revoked_at IS NULL
         AND expires_at > timezone('utc', now())`,
      [sessionId, userId],
    );
    return result.rows[0] ?? null;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<RefreshSessionRow | null> {
    const result = await query<RefreshSessionRow>(
      this.db,
      'SELECT * FROM refresh_sessions WHERE token_hash = $1',
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async findSessionByTokenHashForUpdate(tokenHash: string): Promise<RefreshSessionRow | null> {
    const result = await query<RefreshSessionRow>(
      this.db,
      'SELECT * FROM refresh_sessions WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const result = await query(this.db, `
      UPDATE refresh_sessions
      SET revoked_at = timezone('utc', now())
      WHERE id = $1 AND revoked_at IS NULL
    `, [sessionId]);
    return (result.rowCount ?? 0) === 1;
  }

  async revokeFamily(familyId: string, reuseDetected: boolean): Promise<void> {
    await query(this.db, `
      UPDATE refresh_sessions
      SET
        revoked_at = COALESCE(revoked_at, timezone('utc', now())),
        reuse_detected_at = CASE WHEN $2 THEN timezone('utc', now()) ELSE reuse_detected_at END
      WHERE family_id = $1
    `, [familyId, reuseDetected]);
  }

  async hasChildSession(sessionId: string): Promise<boolean> {
    const result = await query(
      this.db,
      'SELECT 1 FROM refresh_sessions WHERE parent_session_id = $1 LIMIT 1',
      [sessionId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
