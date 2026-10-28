import type { PublicAudit } from '@holobid/contracts';

import { StatusBadge } from '../../components/shared/status-badge';
import { formatDate } from '../../lib/format';

const content = {
  VERIFIED: {
    title: 'Histórico verificado',
    description:
      'O servidor conferiu o histórico completo com a âncora independente. O resultado corresponde à verificação indicada abaixo.',
    tone: 'success',
    border: 'border-success',
  },
  TAMPERED: {
    title: 'Adulteração detectada',
    description:
      'O servidor encontrou uma divergência nos registros ou na âncora independente. O histórico não deve ser tratado como íntegro.',
    tone: 'danger',
    border: 'border-destructive',
  },
  INCOMPLETE: {
    title: 'Verificação incompleta',
    description:
      'Não foi possível concluir todas as verificações. Este estado não confirma integridade nem prova adulteração. Tente verificar novamente.',
    tone: 'warning',
    border: 'border-warning',
  },
} as const;

export function verificationPresentation(
  report: PublicAudit,
  refreshing = false,
  unavailable = false,
) {
  if (unavailable || refreshing) {
    return {
      title: unavailable ? 'Verificação indisponível' : 'Verificando histórico…',
      description:
        'Os dados exibidos são da última consulta. Eles não confirmam a integridade atual enquanto a verificação estiver indisponível ou em andamento.',
      tone: 'warning' as const,
      border: 'border-warning',
    };
  }

  return content[report.integrity];
}

export function VerificationSummary({
  report,
  refreshing = false,
  unavailable = false,
}: {
  report: PublicAudit;
  refreshing?: boolean;
  unavailable?: boolean;
}) {
  const current = verificationPresentation(report, refreshing, unavailable);
  const uncertain = refreshing || unavailable;

  return (
    <section
      className={`border-l-4 bg-card p-6 sm:p-8 ${current.border}`}
      aria-labelledby="integrity-title"
      role="status"
    >
      <StatusBadge tone={current.tone}>{current.title}</StatusBadge>
      <h2 id="integrity-title" className="mt-4 font-display text-3xl font-semibold">
        {uncertain ? 'Aguarde uma nova confirmação.' : current.title}
      </h2>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{current.description}</p>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Última consulta ao servidor</dt>
          <dd className="mt-1 font-semibold">
            <time dateTime={report.checkedAt}>{formatDate(report.checkedAt)} (São Paulo)</time>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sequência verificada até</dt>
          <dd className="mt-1 font-semibold">{report.verifiedThroughSequence}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Registros esperados / encontrados</dt>
          <dd className="mt-1 font-semibold">
            {report.expectedCount ?? 'Indisponível'} / {report.actualCount ?? 'Indisponível'}
          </dd>
        </div>
        {report.firstInvalidSequence !== undefined && (
          <div>
            <dt className="text-muted-foreground">Primeira sequência com divergência</dt>
            <dd className="mt-1 font-semibold text-destructive">{report.firstInvalidSequence}</dd>
          </div>
        )}
      </dl>
      <details className="mt-5 text-sm">
        <summary className="w-fit cursor-pointer py-2 text-info">Detalhes da verificação</summary>
        <dl className="mt-3 space-y-3 rounded-md bg-muted p-4">
          <div>
            <dt className="text-muted-foreground">Código do resultado</dt>
            <dd className="mt-1 break-all font-mono text-xs">{report.reasonCode}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Versão do algoritmo / lote</dt>
            <dd className="mt-1">
              {report.algorithmVersion ?? 'Indisponível'} / {report.version ?? 'Indisponível'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Hash final informado pelo servidor</dt>
            <dd className="mt-1 break-all font-mono text-xs leading-relaxed">
              {report.headHash ?? 'Indisponível nesta verificação'}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
