import { cn } from '../../lib/utils';

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="size-9 shrink-0">
        <path d="M8 10 20 6v16l-8 3v13l-4 2V10Z" fill="currentColor" />
        <path d="m28 10 12-4v30l-12 6V26l8-3V12l-8 3v-5Z" fill="currentColor" />
        <path d="m16 24 16-6v8l-16 6v-8Z" className="fill-info" />
        <path d="m20 6 8 4v8l-8 3V6Z" className="fill-primary" />
      </svg>
      {!compact && <span className="font-display text-3xl font-semibold">HoloBid</span>}
    </span>
  );
}
