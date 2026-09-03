import { Type } from '@sinclair/typebox';

export const RegisterBodySchema = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
  display_name: Type.String({ minLength: 1, maxLength: 64 }),
});

export const LoginBodySchema = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
});

export const PatchMeBodySchema = Type.Object({
  display_name: Type.String({ minLength: 1, maxLength: 64 }),
});

export const UserViewSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  display_name: Type.String(),
  created_at: Type.String({ format: 'date-time' }),
  roles: Type.Array(Type.String()),
  capabilities: Type.Object({
    catalog_admin: Type.Boolean(),
    admin: Type.Boolean(),
  }),
  permissions: Type.Array(Type.String()),
});

export const AuthSessionResponseSchema = Type.Object({
  access_token: Type.String(),
  token_type: Type.Literal('Bearer'),
  expires_in: Type.Integer(),
  user: UserViewSchema,
});
