/**
 * EmptyState Component
 *
 * Reusable empty state display for lists and panels.
 */

import React, { forwardRef, HTMLAttributes } from 'react';
import './EmptyState.css';

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className = '', icon, title, description, action, ...props }, ref) => {
    return (
      <div ref={ref} className={`j-empty-state ${className}`} {...props}>
        {icon && <div className="j-empty-state__icon">{icon}</div>}
        <div className="j-empty-state__content">
          <h3 className="j-empty-state__title">{title}</h3>
          {description && <p className="j-empty-state__description">{description}</p>}
          {action && <div className="j-empty-state__action">{action}</div>}
        </div>
      </div>
    );
  }
);

EmptyState.displayName = 'EmptyState';
