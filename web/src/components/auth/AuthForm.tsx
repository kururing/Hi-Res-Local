import React, { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, LoaderCircle, Mail, UserRound } from 'lucide-react';
import { mapAuthFormError, type AuthFormErrorKey } from '../../auth/errors';
import type { LoginRequest, RegisterRequest } from '../../auth/types';
import { t } from '../../i18n';
import type { AppLanguage } from '../../types/settings';
import { Button } from '../common/Button';
import { Input } from '../common/Input';

export type AuthFormMode = 'login' | 'register';

interface AuthFormProps {
  mode: AuthFormMode;
  language: AppLanguage;
  onLogin: (request: LoginRequest) => Promise<void>;
  onRegister: (request: RegisterRequest) => Promise<void>;
  onSwitchMode: (mode: AuthFormMode) => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
  displayName?: string;
}

const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const DISPLAY_NAME_MAX = 64;

function validateEmail(value: string, language: AppLanguage): string | undefined {
  const email = value.trim();
  if (!email) return t('auth_error_email_required', language);
  if (email.length < 3 || email.length > EMAIL_MAX || !email.includes('@')) {
    return t('auth_error_email_invalid', language);
  }
  return undefined;
}

function validatePassword(value: string, language: AppLanguage): string | undefined {
  if (!value) return t('auth_error_password_required', language);
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return t('auth_error_password_length', language);
  }
  return undefined;
}

function validateDisplayName(value: string, language: AppLanguage): string | undefined {
  const name = value.trim();
  if (!name) return t('auth_error_display_name_required', language);
  if (name.length > DISPLAY_NAME_MAX) return t('auth_error_display_name_length', language);
  return undefined;
}

const BACKEND_ERROR_KEYS: Record<AuthFormErrorKey, 'auth_error_invalid_credentials' | 'auth_error_email_taken' | 'auth_error_invalid_input' | 'auth_error_rate_limited' | 'auth_error_network' | 'auth_error_server'> = {
  invalid_credentials: 'auth_error_invalid_credentials',
  email_taken: 'auth_error_email_taken',
  invalid_input: 'auth_error_invalid_input',
  rate_limited: 'auth_error_rate_limited',
  network: 'auth_error_network',
  server: 'auth_error_server',
};

export const AuthForm: React.FC<AuthFormProps> = ({
  mode,
  language,
  onLogin,
  onRegister,
  onSwitchMode,
}) => {
  const headingId = useId();
  const emailId = useId();
  const passwordId = useId();
  const displayNameId = useId();
  const emailErrorId = useId();
  const passwordErrorId = useId();
  const displayNameErrorId = useId();
  const summaryId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [mode]);

  const title = mode === 'login'
    ? t('auth_login_title', language)
    : t('auth_register_title', language);
  const subtitle = mode === 'login'
    ? t('auth_login_subtitle', language)
    : t('auth_register_subtitle', language);

  const focusFirstError = (errors: FieldErrors, summary: string | null) => {
    if (errors.displayName) {
      displayNameRef.current?.focus();
      return;
    }
    if (errors.email) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }
    if (summary) summaryRef.current?.focus();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || submitting) return;

    const nextErrors: FieldErrors = {
      email: validateEmail(email, language),
      password: validatePassword(password, language),
    };
    if (mode === 'register') {
      nextErrors.displayName = validateDisplayName(displayName, language);
    }

    const hasFieldError = Boolean(nextErrors.email || nextErrors.password || nextErrors.displayName);
    setFieldErrors(nextErrors);
    setFormError(hasFieldError ? t('auth_error_summary', language) : null);
    if (hasFieldError) {
      focusFirstError(nextErrors, t('auth_error_summary', language));
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await onLogin({ email: email.trim(), password });
      } else {
        await onRegister({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
        });
      }
    } catch (error) {
      const key = mapAuthFormError(error);
      const message = t(BACKEND_ERROR_KEYS[key], language);
      const mappedFields: FieldErrors = {};
      if (key === 'invalid_credentials') mappedFields.password = message;
      if (key === 'email_taken') mappedFields.email = message;
      if (key === 'invalid_input' && mode === 'register') mappedFields.displayName = message;
      setFieldErrors(mappedFields);
      setFormError(message);
      queueMicrotask(() => focusFirstError(mappedFields, message));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const switchMode = mode === 'login' ? 'register' : 'login';

  return (
    <form
      className="flex w-full flex-col gap-5 select-text"
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={headingId}
    >
      <div className="space-y-2">
        <h1
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="font-display text-2xl font-bold text-brand-foreground outline-none"
        >
          {title}
        </h1>
        <p className="text-sm leading-relaxed text-brand-muted">{subtitle}</p>
      </div>

      {formError && (
        <div
          ref={summaryRef}
          id={summaryId}
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 outline-none"
        >
          {formError}
        </div>
      )}

      {mode === 'register' && (
        <div className="space-y-2">
          <label htmlFor={displayNameId} className="text-sm font-medium text-brand-foreground">
            {t('auth_display_name_label', language)}
          </label>
          <Input
            ref={displayNameRef}
            id={displayNameId}
            name="name"
            type="text"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX}
            value={displayName}
            aria-invalid={fieldErrors.displayName ? true : undefined}
            aria-describedby={fieldErrors.displayName ? displayNameErrorId : undefined}
            icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
            onChange={event => {
              setDisplayName(event.target.value);
              setFieldErrors(current => ({ ...current, displayName: undefined }));
            }}
          />
          {fieldErrors.displayName && (
            <p id={displayNameErrorId} className="text-xs text-rose-300">
              {fieldErrors.displayName}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor={emailId} className="text-sm font-medium text-brand-foreground">
          {t('auth_email_label', language)}
        </label>
        <Input
          ref={emailRef}
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          maxLength={EMAIL_MAX}
          value={email}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? emailErrorId : undefined}
          icon={<Mail className="h-4 w-4" aria-hidden="true" />}
          onChange={event => {
            setEmail(event.target.value);
            setFieldErrors(current => ({ ...current, email: undefined }));
          }}
        />
        {fieldErrors.email && (
          <p id={emailErrorId} className="text-xs text-rose-300">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor={passwordId} className="text-sm font-medium text-brand-foreground">
          {t('auth_password_label', language)}
        </label>
        <Input
          ref={passwordRef}
          id={passwordId}
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          maxLength={PASSWORD_MAX}
          value={password}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
          className="select-text"
          rightElement={(
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-brand-muted hover:text-brand-foreground"
              aria-label={showPassword ? t('auth_hide_password', language) : t('auth_show_password', language)}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(value => !value)}
            >
              {showPassword
                ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
          onChange={event => {
            setPassword(event.target.value);
            setFieldErrors(current => ({ ...current, password: undefined }));
          }}
        />
        {fieldErrors.password && (
          <p id={passwordErrorId} className="text-xs text-rose-300">
            {fieldErrors.password}
          </p>
        )}
      </div>

      <Button
        type="submit"
        variant="accent"
        className="w-full"
        disabled={submitting}
        aria-busy={submitting}
        icon={submitting ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : undefined}
      >
        {submitting
          ? t('auth_submitting', language)
          : mode === 'login'
            ? t('auth_submit_login', language)
            : t('auth_submit_register', language)}
      </Button>

      <button
        type="button"
        className="min-h-11 text-sm font-medium text-brand-muted hover:text-brand-accent"
        onClick={() => onSwitchMode(switchMode)}
      >
        {mode === 'login'
          ? t('auth_switch_to_register', language)
          : t('auth_switch_to_login', language)}
      </button>
    </form>
  );
};
