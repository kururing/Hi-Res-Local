/** @vitest-environment jsdom */
import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from '../components/auth/AuthForm';
import { CloudApiError } from '../api/client';

function mount(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function field(container: HTMLElement, label: string) {
  const node = Array.from(container.querySelectorAll('label'))
    .find(item => item.textContent === label);
  const id = node?.getAttribute('for');
  const input = id ? container.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`) : null;
  if (!input) throw new Error(`Missing field ${label}`);
  return input;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('AuthForm', () => {
  let mounted: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  it('associates labels, autocomplete, and accessible password toggle', () => {
    const onSwitch = vi.fn();
    mounted = mount(
      <AuthForm
        mode="login"
        language="en"
        onLogin={async () => undefined}
        onRegister={async () => undefined}
        onSwitchMode={onSwitch}
      />
    );
    const email = field(mounted.container, 'Email');
    const password = field(mounted.container, 'Password');
    expect(email.getAttribute('type')).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    const toggle = mounted.container.querySelector('button[aria-label="Show password"]');
    expect(toggle).toBeTruthy();
  });

  it('submits from the keyboard and blocks double submit', async () => {
    let resolveLogin!: () => void;
    const login = vi.fn(() => new Promise<void>(resolve => {
      resolveLogin = resolve;
    }));
    mounted = mount(
      <AuthForm
        mode="login"
        language="en"
        onLogin={login}
        onRegister={async () => undefined}
        onSwitchMode={() => undefined}
      />
    );
    await typeInto(field(mounted.container, 'Email'), 'bang@example.com');
    await typeInto(field(mounted.container, 'Password'), 'correct-horse');
    const form = mounted.container.querySelector('form');
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({ email: 'bang@example.com', password: 'correct-horse' });
    expect(mounted.container.textContent).toContain('Working');
    await act(async () => {
      resolveLogin();
    });
  });

  it('places errors next to fields and focuses the first invalid field', async () => {
    mounted = mount(
      <AuthForm
        mode="register"
        language="en"
        onLogin={async () => undefined}
        onRegister={async () => undefined}
        onSwitchMode={() => undefined}
      />
    );
    const form = mounted.container.querySelector('form');
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const displayName = field(mounted.container, 'Display name');
    expect(displayName.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(displayName);
    expect(mounted.container.textContent).toContain('Enter a display name.');
  });

  it('maps duplicate email onto the email field', async () => {
    const register = vi.fn(async () => {
      throw new CloudApiError('Email is already registered.', 409, {
        code: 'AUTH_EMAIL_TAKEN',
        message: 'Email is already registered.',
        request_id: 'r',
      }, 'AUTH_EMAIL_TAKEN');
    });
    mounted = mount(
      <AuthForm
        mode="register"
        language="en"
        onLogin={async () => undefined}
        onRegister={register}
        onSwitchMode={() => undefined}
      />
    );
    await typeInto(field(mounted.container, 'Display name'), 'Bang');
    await typeInto(field(mounted.container, 'Email'), 'bang@example.com');
    await typeInto(field(mounted.container, 'Password'), 'correct-horse');
    await act(async () => {
      mounted?.container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const email = field(mounted.container, 'Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(mounted.container.textContent).toContain('That email is already registered.');
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(email);
  });

  it('does not block password paste', async () => {
    mounted = mount(
      <AuthForm
        mode="login"
        language="en"
        onLogin={async () => undefined}
        onRegister={async () => undefined}
        onSwitchMode={() => undefined}
      />
    );
    const password = field(mounted.container, 'Password');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    password.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await typeInto(password, 'pasted-password-ok');
    expect(password.value).toBe('pasted-password-ok');
  });

  it('moves focus to the heading when switching login and register', async () => {
    const Harness: React.FC = () => {
      const [mode, setMode] = useState<'login' | 'register'>('login');
      return (
        <AuthForm
          mode={mode}
          language="en"
          onLogin={async () => undefined}
          onRegister={async () => undefined}
          onSwitchMode={setMode}
        />
      );
    };
    mounted = mount(<Harness />);
    expect(document.activeElement?.textContent).toBe('Sign in');
    const switchButton = Array.from(mounted.container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Need an account'));
    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mounted.container.querySelector('h1')?.textContent).toBe('Create account');
    expect(document.activeElement?.textContent).toBe('Create account');
    expect(field(mounted.container, 'Password').getAttribute('autocomplete')).toBe('new-password');
  });
});
