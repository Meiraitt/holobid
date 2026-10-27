import { useEffect, useRef } from 'react';

import { toast } from '../../../components/ui/toast';
import { formatDate } from '../../../lib/format';

export function Countdown({
  deadline,
  now,
  scheduled = false,
}: {
  deadline: string;
  now: number;
  scheduled?: boolean;
}) {
  const previousDeadline = useRef(deadline);

  useEffect(() => {
    if (!scheduled && Date.parse(deadline) > Date.parse(previousDeadline.current)) {
      toast.info('Prazo prorrogado', `O lote agora encerra em ${formatDate(deadline)}.`);
    }

    previousDeadline.current = deadline;
  }, [deadline, scheduled]);

  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const countdown =
    days > 0
      ? `${days}d ${hours}h`
      : [
          hours > 0 ? String(hours).padStart(2, '0') : null,
          String(minutes).padStart(2, '0'),
          String(remainder).padStart(2, '0'),
        ]
          .filter(Boolean)
          .join(':');

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-muted-foreground">{scheduled ? 'Começa em' : 'Encerra em'}</p>
        <p
          aria-label={
            seconds === 0
              ? 'Aguardando atualização do lote'
              : `${days} dias, ${hours} horas, ${minutes} minutos e ${remainder} segundos`
          }
          className={`mt-1 font-display text-3xl font-semibold tabular-nums ${seconds < 60 && !scheduled ? 'text-warning' : 'text-foreground'}`}
        >
          {seconds === 0 ? 'Aguardando atualização' : countdown}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        <time dateTime={deadline}>{formatDate(deadline)}</time>
        <span className="mt-1 block">Horário de Brasília</span>
      </p>
    </div>
  );
}
