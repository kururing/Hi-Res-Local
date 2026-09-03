import type { Queryable } from '../db/types.js';
import {
  ADMIN_ROLE,
  CATALOG_ADMIN_ROLE,
  permissionsFor,
  type KnownRole,
  type RoleCapabilities,
} from './roles.js';
import { RolesRepository } from './repository.js';

export class RolesService {
  constructor(private readonly db: Queryable) {}

  async listRoles(userId: string): Promise<KnownRole[]> {
    const rows = await new RolesRepository(this.db).listForUser(userId);
    return rows.map((row) => row.role);
  }

  async hasRole(userId: string, role: KnownRole): Promise<boolean> {
    return new RolesRepository(this.db).hasRole(userId, role);
  }

  async hasCatalogAdmin(userId: string): Promise<boolean> {
    const roles = await this.listRoles(userId);
    return roles.includes(ADMIN_ROLE) || roles.includes(CATALOG_ADMIN_ROLE);
  }

  async capabilities(userId: string): Promise<RoleCapabilities> {
    const roles = await this.listRoles(userId);
    const admin = roles.includes(ADMIN_ROLE);
    return {
      admin,
      catalog_admin: admin || roles.includes(CATALOG_ADMIN_ROLE),
    };
  }

  async identity(userId: string): Promise<{
    roles: KnownRole[];
    capabilities: RoleCapabilities;
    permissions: string[];
  }> {
    const roles = await this.listRoles(userId);
    const capabilities = await this.capabilities(userId);
    return {
      roles,
      capabilities,
      permissions: permissionsFor(capabilities),
    };
  }
}
