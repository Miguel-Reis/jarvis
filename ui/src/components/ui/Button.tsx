/**
 * Button Component
 *
 * Reusable button with variants and sizes.
 */

import React, { ButtonHTMLAttributes, forwardRef } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      loading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const classes = [
      'j-button',
      `j-button--${variant}`,
      `j-button--${size}`,
      fullWidth ? 'j-button--full-width' : '',
      loading ? 'j-button--loading' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <span className="j-button__spinner" />}
        {leftIcon && <span className="j-button__icon j-button__icon--left">{leftIcon}</span>}
        {children && <span className="j-button__content">{children}</span>}
        {rightIcon && <span className="j-button__icon j-button__icon--right">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
