import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] select-none';

  const variantClasses = {
    primary: 'bg-brand-primary text-white hover:bg-indigo-900 border border-brand-border shadow-sm',
    secondary: 'bg-brand-secondary text-white hover:bg-indigo-600 shadow-sm hover:shadow-glow-indigo',
    accent: 'bg-brand-accent text-oled-base font-semibold hover:bg-brand-accentHover shadow-sm hover:shadow-glow-accent',
    ghost: 'bg-transparent text-brand-muted hover:text-brand-foreground hover:bg-oled-hover',
    danger: 'bg-rose-600/20 text-rose-300 border border-rose-600/40 hover:bg-rose-600 hover:text-white',
  };

  const sizeClasses = {
    sm: 'min-h-[36px] px-3 py-1.5 text-xs gap-1.5',
    md: 'min-h-[44px] px-4 py-2 text-sm gap-2', // Standard 44px touch target
    lg: 'min-h-[50px] px-6 py-3 text-base gap-2.5',
    icon: 'min-w-[44px] min-h-[44px] p-2.5 rounded-full',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      {children}
    </button>
  );
};
