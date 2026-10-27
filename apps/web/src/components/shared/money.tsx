import { formatMoney } from '../../lib/format';
import { cn } from '../../lib/utils';

export { formatMoney };
export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatMoney(cents)}</span>;
}
