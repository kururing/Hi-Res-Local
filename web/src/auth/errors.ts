import { CloudApiError } from '../api/client';
import { cloudErrorCode } from './mapper';

export type AuthFormErrorKey =
  | 'invalid_credentials'
  | 'email_taken'
  | 'invalid_input'
  | 'rate_limited'
  | 'network'
  | 'server';

export function mapAuthFormError(error: unknown): AuthFormErrorKey {
  const code = cloudErrorCode(error);
  if (code === 'AUTH_INVALID_CREDENTIALS') return 'invalid_credentials';
  if (code === 'AUTH_EMAIL_TAKEN') return 'email_taken';
  if (code === 'VALIDATION_ERROR') return 'invalid_input';
  if (code === 'RATE_LIMITED') return 'rate_limited';

  if (error instanceof CloudApiError) {
    if (error.status === 409) return 'email_taken';
    if (error.status === 401) return 'invalid_credentials';
    if (error.status === 400) return 'invalid_input';
    if (error.status === 429) return 'rate_limited';
    if (error.status === 0 || error.status >= 500) return 'server';
  }

  if (error instanceof TypeError) return 'network';
  if (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return 'network';
  }
  return 'server';
}
