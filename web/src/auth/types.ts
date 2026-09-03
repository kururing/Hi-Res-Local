export interface UserCapabilities {
  catalog_admin: boolean;
  admin: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt?: string;
  updatedAt?: string;
  roles?: string[];
  capabilities?: UserCapabilities;
  permissions?: string[];
}

export interface AuthSessionResult {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
}

export type AuthStatus =
  | 'bootstrapping'
  | 'authenticated'
  | 'anonymous'
  | 'offline';

export interface AuthSnapshot {
  status: AuthStatus;
  user: AuthUser | null;
}

export interface AccountApi {
  register(request: RegisterRequest): Promise<AuthSessionResult>;
  login(request: LoginRequest): Promise<AuthSessionResult>;
  refresh(): Promise<AuthSessionResult>;
  logout(): Promise<void>;
  getProfile(): Promise<AuthUser>;
  updateProfile(request: UpdateProfileRequest): Promise<AuthUser>;
  getPreferences?(): Promise<AccountPreferences>;
  putPreferences?(input: { revision?: number; preferences: Record<string, unknown> }): Promise<AccountPreferences>;
}

export interface AccountPreferences {
  schema_version: number;
  revision: number;
  preferences: Record<string, unknown>;
  updated_at: string;
}

export type AuthBroadcastMessage =
  | { type: 'session-changed' }
  | { type: 'logout' };

export interface AuthBroadcast {
  post(message: AuthBroadcastMessage): void;
  subscribe(handler: (message: AuthBroadcastMessage) => void): () => void;
  close(): void;
}
