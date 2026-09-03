import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { CATALOG_ADMIN_ROLE } from '../rbac/roles.js';

export async function requireCatalogAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await request.server.authenticate(request, reply);
  const userId = request.authUser?.id;
  if (!userId) {
    throw new AppError(401, ErrorCodes.AUTH_UNAUTHORIZED, 'Authentication required.');
  }
  const allowed = await request.server.rolesService.hasCatalogAdmin(userId);
  if (!allowed) {
    throw new AppError(403, ErrorCodes.ADMIN_FORBIDDEN, 'Catalog admin role is required.');
  }
}

export { CATALOG_ADMIN_ROLE };
