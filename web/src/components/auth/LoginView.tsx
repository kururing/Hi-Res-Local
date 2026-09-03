import React from 'react';
import { AuthForm } from './AuthForm';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';

interface LoginViewProps {
  onSwitchToRegister: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSwitchToRegister }) => {
  const { login } = useAuth();
  const { settings } = useSettings();

  return (
    <AuthForm
      mode="login"
      language={settings.language}
      onLogin={login}
      onRegister={async () => undefined}
      onSwitchMode={next => {
        if (next === 'register') onSwitchToRegister();
      }}
    />
  );
};
