import type React from 'react';

/** Give non-native interactive surfaces Enter/Space behavior without hijacking nested controls. */
export function activateOnKeyboard(
  event: React.KeyboardEvent<HTMLElement>,
  action: () => void
): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}
