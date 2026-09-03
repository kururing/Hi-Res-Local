-- Catalog administration roles. Users cannot self-grant; only local CLI writes this table.
-- Role checks are read from this table on every admin request so revoke is immediate.

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  granted_by UUID REFERENCES users (id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, role),
  CONSTRAINT user_roles_role_known CHECK (role IN ('catalog_admin'))
);

CREATE INDEX idx_user_roles_role ON user_roles (role);
