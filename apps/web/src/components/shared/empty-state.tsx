import { Layers3 } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed px-6 py-16 text-center',
        className,
      )}
    >
      <Layers3 className="mb-5 size-9 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-2xl">{title}</h2>
      <p className="mt-3 max-w-md text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
