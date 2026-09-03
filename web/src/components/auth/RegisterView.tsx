import React from 'react';
import { AuthForm } from './AuthForm';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';

interface RegisterViewProps {
  onSwitchToLogin: () => void;
}

export const RegisterView: React.FC<RegisterViewProps> = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const { settings } = useSettings();

  return (
    <AuthForm
      mode="register"
      language={settings.language}
      onLogin={async () => undefined}
      onRegister={register}
      onSwitchMode={next => {
        if (next === 'login') onSwitchToLogin();
      }}
    />
  );
};
