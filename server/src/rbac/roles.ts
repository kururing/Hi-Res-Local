export const CATALOG_ADMIN_ROLE = 'catalog_admin' as const;
export const ADMIN_ROLE = 'admin' as const;

export const KNOWN_ROLES = [ADMIN_ROLE, CATALOG_ADMIN_ROLE] as const;

export type KnownRole = (typeof KNOWN_ROLES)[number];

export const PERMISSIONS = {
  CATALOG_READ: 'catalog.read',
  CATALOG_WRITE: 'catalog.write',
  USERS_ROLES: 'users.roles',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function isKnownRole(value: string): value is KnownRole {
  return (KNOWN_ROLES as readonly string[]).includes(value);
}

export interface RoleCapabilities {
  catalog_admin: boolean;
  admin: boolean;
}

export function permissionsFor(capabilities: RoleCapabilities): Permission[] {
  const permissions: Permission[] = [PERMISSIONS.CATALOG_READ];
  if (capabilities.catalog_admin) permissions.push(PERMISSIONS.CATALOG_WRITE);
  if (capabilities.admin) permissions.push(PERMISSIONS.USERS_ROLES);
  return permissions;
}
