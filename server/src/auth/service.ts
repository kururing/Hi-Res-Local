import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import { withTransaction } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import type { RolesService } from '../rbac/service.js';
import type { PasswordHasher } from './password.js';
import { AuthRepository, UsersRepository, type UserWithProfile } from './repository.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  normalizeEmail,
  signAccessToken,
} from './tokens.js';

const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const DISPLAY_NAME_MAX = 64;

export interface AuthUserView {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  roles: string[];
  capabilities: {
    catalog_admin: boolean;
    admin: boolean;
  };
  permissions: string[];
}

export interface AuthSessionResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: AuthUserView;
}

export interface RegisterInput {
  email: string;
  password: string;
  display_name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SessionMeta {
  userAgent?: string | string[];
  ipAddress?: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function toView(user: UserWithProfile, roles: RolesService): Promise<AuthUserView> {
  const identity = await roles.identity(user.id);
  return {
    id: user.id,
    email: user.email_normalized,
    display_name: user.display_name,
    created_at: iso(user.created_at),
    roles: identity.roles,
    capabilities: identity.capabilities,
    permissions: identity.permissions,
  };
}

function clipMeta(value: string | string[] | undefined, max: number): string | null {
  if (value == null) return null;
  const text = Array.isArray(value) ? value.join(', ') : value;
  return text.slice(0, max);
}

function validateEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (normalized.length < 3 || normalized.length > EMAIL_MAX || !normalized.includes('@')) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Invalid email.');
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    );
  }
}

function validateDisplayName(name: string): string {
  const displayName = name.trim();
  if (displayName.length < 1 || displayName.length > DISPLAY_NAME_MAX) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      `Display name must be between 1 and ${DISPLAY_NAME_MAX} characters.`,
    );
  }
  return displayName;
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly users: UsersRepository,
    private readonly sessions: AuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly config: AppConfig,
    private readonly roles: RolesService,
  ) {}

  async register(input: RegisterInput, meta: SessionMeta): Promise<AuthSessionResult> {
    const emailNormalized = validateEmail(input.email);
    validatePassword(input.password);
    const displayName = validateDisplayName(input.display_name);

    const existing = await this.users.findByNormalizedEmail(emailNormalized);
    if (existing) {
      await this.hasher.hash(input.password);
      throw new AppError(409, ErrorCodes.AUTH_EMAIL_TAKEN, 'Email is already registered.');
    }

    const passwordHash = await this.hasher.hash(input.password);
    const userId = randomUUID();

    try {
      await withTransaction(this.pool, async (trx) => {
        const trxUsers = new UsersRepository(trx);
        await trxUsers.insertUser(userId, emailNormalized, emailNormalized, passwordHash, displayName);
      });
    } catch (error) {
      const existingAfter = await this.users.findByNormalizedEmail(emailNormalized);
      if (existingAfter) {
        throw new AppError(409, ErrorCodes.AUTH_EMAIL_TAKEN, 'Email is already registered.');
      }
      throw error;
    }

    const user = await this.users.findById(userId);
    if (!user) throw new AppError(500, ErrorCodes.INTERNAL_ERROR, 'Failed to create user.');
    return this.issueSession(user, meta, randomUUID(), null);
  }

  async login(input: LoginInput, meta: SessionMeta): Promise<AuthSessionResult> {
    const emailNormalized = validateEmail(input.email);
    validatePassword(input.password);
    const userRow = await this.users.findByNormalizedEmail(emailNormalized);
    const invalid = () =>
      new AppError(401, ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid credentials.');

    if (!userRow) {
      await this.hasher.hash(input.password);
      throw invalid();
    }

    const matches = await this.hasher.verify(userRow.password_hash, input.password);
    if (!matches) throw invalid();

    const user = await this.users.findById(userRow.id);
    if (!user) throw invalid();
    return this.issueSession(user, meta, randomUUID(), null);
  }

  async refresh(refreshToken: string | undefined, meta: SessionMeta): Promise<AuthSessionResult> {
    if (!refreshToken) {
      throw new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Refresh token missing.');
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const outcome = await withTransaction<
      { result: AuthSessionResult; error?: never } | { result?: never; error: AppError }
    >(this.pool, async (trx) => {
      const sessions = new AuthRepository(trx);
      const session = await sessions.findSessionByTokenHashForUpdate(tokenHash);
      if (!session) {
        return { error: new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Refresh token invalid.') };
      }

      if (session.revoked_at) {
        const rotated = await sessions.hasChildSession(session.id);
        if (rotated) {
          await sessions.revokeFamily(session.family_id, true);
          return { error: new AppError(401, ErrorCodes.AUTH_REFRESH_REUSE, 'Refresh token reuse detected.') };
        }
        return { error: new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Refresh token invalid.') };
      }

      if (new Date(session.expires_at).getTime() <= Date.now()) {
        await sessions.revokeSession(session.id);
        return { error: new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Refresh token expired.') };
      }

      const user = await new UsersRepository(trx).findById(session.user_id);
      if (!user) {
        await sessions.revokeFamily(session.family_id, false);
        return { error: new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Refresh token invalid.') };
      }

      const consumed = await sessions.revokeSession(session.id);
      if (!consumed) {
        return { error: new AppError(401, ErrorCodes.AUTH_REFRESH_REUSE, 'Refresh token reuse detected.') };
      }
      return { result: await this.issueSession(user, meta, session.family_id, session.id, sessions) };
    });
    if (outcome.error) throw outcome.error;
    return outcome.result;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const session = await this.sessions.findSessionByTokenHash(hashRefreshToken(refreshToken));
    if (session && !session.revoked_at) {
      await this.sessions.revokeSession(session.id);
    }
  }

  async assertActiveSession(sessionId: string, userId: string): Promise<void> {
    const session = await this.sessions.findActiveSession(sessionId, userId);
    if (!session) {
      throw new AppError(401, ErrorCodes.AUTH_UNAUTHORIZED, 'Session is no longer active.');
    }
  }

  async me(userId: string): Promise<AuthUserView> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AppError(401, ErrorCodes.AUTH_UNAUTHORIZED, 'Authentication required.');
    }
    return toView(user, this.roles);
  }

  async updateMe(userId: string, displayNameRaw: string): Promise<AuthUserView> {
    const displayName = validateDisplayName(displayNameRaw);
    const user = await this.users.updateDisplayName(userId, displayName);
    return toView(user, this.roles);
  }

  private async issueSession(
    user: UserWithProfile,
    meta: SessionMeta,
    familyId: string,
    parentSessionId: string | null,
    sessions: AuthRepository = this.sessions,
  ): Promise<AuthSessionResult> {
    const sessionId = randomUUID();
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000);

    await sessions.insertSession({
      id: sessionId,
      userId: user.id,
      familyId,
      parentSessionId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: clipMeta(meta.userAgent, 512),
      ipAddress: clipMeta(meta.ipAddress, 64),
    });

    const access = await signAccessToken(this.config, user.id, sessionId);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      user: await toView(user, this.roles),
    };
  }
}
