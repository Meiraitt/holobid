import { cn } from '../../lib/utils';

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="size-9 shrink-0">
        <path d="M8 9 12 5h6v14h12V5h10v34l-4 4h-6V27H18v16H8V9Z" fill="currentColor" />
        <path d="M18 19h12v8H18z" className="fill-info" />
        <path d="M34 5h6v6z" className="fill-primary" />
      </svg>
      {!compact && <span className="font-display text-3xl font-semibold">HoloBid</span>}
    </span>
  );
}
