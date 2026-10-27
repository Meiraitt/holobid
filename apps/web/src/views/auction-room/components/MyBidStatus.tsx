import { Link } from 'react-router-dom';

import type { DemoAuction } from '../../../demo/types';
import { formatMoney } from '../../../lib/format';

export function MyBidStatus({ auction }: { auction: DemoAuction }) {
  const participation = auction.participation;

  if (!participation) {
    return (
      <div className="border-y border-border py-4">
        <p className="font-semibold">Seu primeiro lance pode ser o próximo.</p>
        <p className="mt-1 text-sm text-muted-foreground">Você ainda não participou deste lote.</p>
      </div>
    );
  }

  const messages = {
    leading: {
      title: 'Você está na liderança',
      description: `${formatMoney(auction.myBidCents ?? auction.currentBidCents)} reservados enquanto você lidera. O resultado só é definido após o encerramento.`,
      tone: 'text-success',
    },
    outbid: {
      title: `Você foi superado${auction.position ? ` · ${auction.position}º lugar` : ''}`,
      description: `Seu maior lance foi ${formatMoney(auction.myBidCents ?? 0)}. A reserva desse lance foi liberada.`,
      tone: 'text-warning',
    },
    won: {
      title:
        auction.settlement === 'settled'
          ? 'Carta arrematada por você'
          : 'Você terminou na liderança',
      description:
        auction.settlement === 'settled'
          ? 'A liquidação foi concluída. Seu comprovante está disponível abaixo.'
          : 'Aguarde a conclusão da liquidação para confirmar o arremate.',
      tone: auction.settlement === 'settled' ? 'text-success' : 'text-warning',
    },
    lost: {
      title: 'Outro participante arrematou este lote',
      description: 'Seu saldo reservado foi liberado. Há outras cartas na vitrine.',
      tone: 'text-muted-foreground',
    },
    pending: {
      title: 'Resultado em processamento',
      description: 'O lote encerrou. Seu saldo e o resultado serão confirmados após a liquidação.',
      tone: 'text-warning',
    },
  };
  const message = messages[participation];

  return (
    <div className="border-y border-border py-4" aria-live="polite">
      <p className={`font-semibold ${message.tone}`}>{message.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message.description}</p>
      <Link
        to="/participations"
        className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-info underline-offset-4 hover:underline"
      >
        Ver minhas participações
      </Link>
    </div>
  );
}
