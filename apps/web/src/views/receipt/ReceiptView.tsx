import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { EmptyState } from '../../components/shared/empty-state';
import { PageHeader } from '../../components/shared/page-header';
import { PublicLink } from '../../components/shared/public-link';
import { Button, buttonVariants } from '../../components/ui/button';
import { ApiRequestError, errorMessage } from '../../services/api-error';

import { receiptOptions } from './receipt-queries';
import { ReceiptDocument } from './ReceiptDocument';

export function ReceiptView() {
  const { receiptId = '' } = useParams();

  return <Receipt key={receiptId} code={receiptId} />;
}

function Receipt({ code }: { code: string }) {
  const query = useQuery(receiptOptions(code));
  const missing = query.error instanceof ApiRequestError && [400, 404].includes(query.error.status);

  return (
    <section className="mx-auto max-w-4xl space-y-7">
      <div className="print:hidden">
        <PageHeader
          title="Comprovante de arremate"
          description="Um registro público da carta e do resultado, sem expor dados pessoais."
          action={
            query.isSuccess ? (
              <PublicLink path={`/receipts/${encodeURIComponent(code)}`} />
            ) : undefined
          }
        />
      </div>
      {query.isPending ? (
        <p role="status">Carregando comprovante…</p>
      ) : query.isError ? (
        <EmptyState
          title={missing ? 'Comprovante não encontrado' : 'Comprovante indisponível'}
          description={
            missing
              ? 'Confira o endereço completo. O comprovante só fica disponível após um arremate concluído.'
              : errorMessage(query.error)
          }
          action={
            <>
              <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
              <Link className={buttonVariants({ variant: 'ghost' })} to="/auctions">
                Explorar leilões
              </Link>
            </>
          }
        />
      ) : (
        <ReceiptDocument receipt={query.data} />
      )}
    </section>
  );
}
