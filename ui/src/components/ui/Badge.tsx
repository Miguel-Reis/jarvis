/**
 * Badge Component
 *
 * Reusable badge/tag for status, types, and labels.
 */

import React, { HTMLAttributes, forwardRef } from 'react';
import './Badge.css';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
export type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className = '',
      variant = 'default',
      size = 'md',
      dot = false,
      children,
      ...props
    },
    ref
  ) => {
    const classes = [
      'j-badge',
      `j-badge--${variant}`,
      `j-badge--${size}`,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <span ref={ref} className={classes} {...props}>
        {dot && <span className="j-badge__dot" />}
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
