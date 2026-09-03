import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ icon, rightElement, className = '', ...props }, ref) => {
    return (
      <div className="relative flex items-center w-full">
        {icon && (
          <div className="absolute left-3.5 flex items-center pointer-events-none text-brand-muted">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={`w-full min-h-[44px] bg-oled-card border border-brand-border text-brand-foreground placeholder-brand-muted rounded-lg px-4 text-sm transition-all select-text focus:border-brand-secondary focus:bg-oled-hover focus-visible:outline-none ${
            icon ? 'pl-10' : ''
          } ${rightElement ? 'pr-10' : ''} ${className}`}
          {...props}
        />
        {rightElement && (
          <div className="absolute right-3 flex items-center">
            {rightElement}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
