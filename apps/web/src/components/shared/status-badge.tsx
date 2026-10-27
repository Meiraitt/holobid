import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-sm font-semibold',
        {
          neutral: 'text-muted-foreground',
          success: 'text-success',
          warning: 'text-warning',
          danger: 'text-destructive',
          info: 'text-info',
        }[tone],
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}
