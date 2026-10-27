import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { OwnedAuctionDetail } from '@holobid/contracts';

import { ConfirmationDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { api } from '../../services';
import { errorMessage } from '../../services/api-error';
import { DurableAttempt } from '../../services/durable-attempt';

export function CancelAuctionDialog({
  auction,
  userId,
  onClose,
}: {
  auction: OwnedAuctionDetail;
  userId: string;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt] = useState(() => {
    try {
      return new DurableAttempt(
        (operation: Parameters<typeof api.auctions.cancel>[1]) =>
          api.auctions.cancel(auction.id, operation),
        (result) => result.data.status === 'CANCELLED',
        sessionStorage,
        `holobid-cancel:${userId}:${auction.id}`,
        (input) => Object.keys(input).length === 0,
      );
    } catch {
      return null;
    }
  });

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  async function cancel() {
    if (!attempt || busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await attempt.submit({});
      if (active.current) {
        toast.success('Lote cancelado', 'O histórico foi preservado em seus leilões.');
        onClose();
      }
    } catch (failure) {
      if (active.current) {
        setError(errorMessage(failure));
        toast.error('Cancelamento não confirmado', errorMessage(failure));
      }
    } finally {
      if (active.current) {
        void cache.invalidateQueries({ queryKey: ['private', userId] });
        void cache.invalidateQueries({ queryKey: ['public'] });
        setBusy(false);
      }
    }
  }

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={`Cancelar ${auction.title}?`}
      description={
        !attempt
          ? 'Não foi possível recuperar a solicitação nesta aba. Recarregue e confira seus lotes antes de tentar novamente.'
          : error ||
            (attempt.operation
              ? 'A resposta anterior não foi confirmada. Consulte novamente para recuperar o mesmo cancelamento.'
              : 'O lote sairá da vitrine e permanecerá no seu histórico. O cancelamento só será aceito se nenhum lance tiver sido registrado.')
      }
      confirmLabel={attempt?.operation ? 'Consultar cancelamento' : 'Cancelar lote'}
      destructive
      busy={busy}
      confirmDisabled={!attempt || (!auction.canCancel && !attempt.operation)}
      onConfirm={() => void cancel()}
    />
  );
}
