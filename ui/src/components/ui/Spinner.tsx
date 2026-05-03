/**
 * Spinner Component
 *
 * Loading spinner with configurable size and color.
 */

import React, { forwardRef, HTMLAttributes } from 'react';
import './Spinner.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';
export type SpinnerColor = 'default' | 'primary' | 'white';

interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize;
  color?: SpinnerColor;
}

export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className = '', size = 'md', color = 'default', ...props }, ref) => {
    const classes = [
      'j-spinner',
      `j-spinner--${size}`,
      `j-spinner--${color}`,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div ref={ref} className={classes} {...props}>
        <div className="j-spinner__circle" />
      </div>
    );
  }
);

Spinner.displayName = 'Spinner';
