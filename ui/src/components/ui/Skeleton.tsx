/**
 * Skeleton Component
 *
 * Loading placeholder for content.
 */

import { forwardRef, type HTMLAttributes } from 'react';
import './Skeleton.css';

export type SkeletonVariant = 'text' | 'circular' | 'rectangular' | 'rounded';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      className = '',
      variant = 'text',
      width,
      height,
      animation = 'pulse',
      style,
      ...props
    },
    ref
  ) => {
    const classes = [
      'j-skeleton',
      `j-skeleton--${variant}`,
      `j-skeleton--${animation}`,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const inlineStyle: React.CSSProperties = {
      ...style,
      ...(width && { width }),
      ...(height && { height }),
    };

    return <div ref={ref} className={classes} style={inlineStyle} {...props} />;
  }
);

Skeleton.displayName = 'Skeleton';
