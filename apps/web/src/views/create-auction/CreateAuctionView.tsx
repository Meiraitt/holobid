import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import type { AuctionDetail } from '@holobid/contracts';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { CardPreviewSkeleton } from '../../components/shared/loading-skeletons';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { formatMoney, parseMoney } from '../../lib/format';
import { queryKeys } from '../../lib/query-client';
import { useAuth } from '../../providers/auth-provider';
import { api, apiClient } from '../../services';
import { errorMessage } from '../../services/api-error';
import { mediaUrl } from '../../services/media-url';

import { CatalogPicker } from './CatalogPicker';
import { type CreateErrors, PublicationAttempt, publicationInput } from './publication';

function localDateTime(offsetMinutes: number) {
  const date = new Date(Date.now() + offsetMinutes * 60_000);

  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());

  return date.toISOString().slice(0, 16);
}

export function CreateAuctionView() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [attemptState] = useState(() => {
    try {
      return {
        attempt: new PublicationAttempt(api.auctions.create, window.sessionStorage, user!.id),
      };
    } catch {
      return {
        error:
          'Não foi possível recuperar a publicação desta aba. Confira seus lotes antes de iniciar outra publicação.',
      };
    }
  });
  const attempt = attemptState.attempt;
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<AuctionDetail>();
  const active = useRef(true);

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  const [cardId, setCardId] = useState('');
  const [startingBid, setStartingBid] = useState('100,00');
  const [increment, setIncrement] = useState('10,00');
  const [startImmediately, setStartImmediately] = useState(true);
  const [startsAt, setStartsAt] = useState(() => localDateTime(30));
  const [endsAt, setEndsAt] = useState(() => localDateTime(180));
  const [errors, setErrors] = useState<CreateErrors>({});
  const details = useQuery({
    queryKey: queryKeys.private(user!.id, 'catalog-item', { cardId }),
    queryFn: ({ signal }) => api.catalog.detail(cardId, signal),
    enabled: Boolean(cardId),
    staleTime: 60_000,
  });
  const selected = details.data;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startingCents = parseMoney(startingBid);
  const incrementCents = parseMoney(increment);
  const endDate = new Date(endsAt);

  function clearError(field: keyof CreateErrors) {
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  async function send(input?: Parameters<PublicationAttempt['submit']>[0]) {
    if (!attempt || busy) {
      return;
    }

    setBusy(true);
    setErrors({});

    try {
      const result = await attempt.submit(input);

      if (!active.current) {
        return;
      }

      if (result.data.confirmation === 'CONFIRMED') {
        setCompleted(result.data);
        void cache.invalidateQueries({ queryKey: ['public'] });
        void cache.invalidateQueries({ queryKey: ['private', user!.id] });
        toast.success('Leilão publicado', `${result.data.title} já está disponível na vitrine.`);
      } else {
        toast.info(
          'Confirmação pendente',
          'Sua solicitação foi registrada. Consulte novamente sem criar outro lote.',
        );
      }
    } catch (error) {
      if (!active.current) {
        return;
      }

      const message = errorMessage(error);

      setErrors({ form: message });
      toast.error(
        attempt.operation ? 'Publicação ainda não confirmada' : 'Leilão não publicado',
        message,
      );
    } finally {
      if (active.current) {
        setBusy(false);
      }
    }
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = publicationInput({
      cardId: selected?.externalId ?? '',
      startingBid,
      increment,
      startImmediately,
      startsAt,
      endsAt,
    });

    setErrors(result.errors);
    if (!result.input) {
      const firstError = Object.keys(result.errors)[0];

      document.getElementById(`create-${firstError === 'card' ? 'search' : firstError}`)?.focus();

      return;
    }

    void send(result.input);
  }

  if (attemptState.error) {
    return (
      <EmptyState
        title="Publicação indisponível nesta aba"
        description={attemptState.error}
        action={
          <Link to="/my-auctions" className={buttonVariants()}>
            Ver meus lotes
          </Link>
        }
      />
    );
  }

  if (completed) {
    return (
      <section className="space-y-6">
        <PageHeader
          title="Leilão publicado"
          description={`${completed.title} · ${completed.setName}`}
        />
        <p role="status">A publicação foi confirmada. Seu lote já aparece na vitrine.</p>
        <div className="flex flex-wrap gap-3">
          <Link className={buttonVariants()} to={`/auctions/${completed.id}`}>
            Ver lote publicado
          </Link>
          <Link className={buttonVariants({ variant: 'outline' })} to="/auctions">
            Voltar à vitrine
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              setCompleted(undefined);
              setCardId('');
            }}
          >
            Criar outro lote
          </Button>
        </div>
      </section>
    );
  }

  if (attempt?.operation) {
    return (
      <section className="space-y-6">
        <PageHeader
          title="Publicação aguardando confirmação"
          description="Os dados desta solicitação estão salvos nesta aba. Ao consultar novamente, reutilizamos a mesma publicação para evitar duplicidade."
        />
        <dl className="space-y-2">
          <dt>Carta</dt>
          <dd>{attempt.operation.input.externalItemId}</dd>
          <dt>Lance inicial</dt>
          <dd>{formatMoney(attempt.operation.input.startingPriceCents)}</dd>
          <dt>Encerramento</dt>
          <dd>
            {new Date(attempt.operation.input.endsAt).toLocaleString('pt-BR')} ({timezone})
          </dd>
        </dl>
        {errors.form && (
          <p role="alert" className="text-destructive">
            {errors.form}
          </p>
        )}
        <Button loading={busy} onClick={() => void send()}>
          Consultar publicação
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <PageHeader
        title="Criar leilão"
        description="Escolha a carta do catálogo e defina as condições do lote."
        action={
          <Link className={buttonVariants({ variant: 'ghost' })} to="/my-auctions">
            Voltar aos meus leilões
          </Link>
        }
      />

      <form
        className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)] lg:gap-12"
        noValidate
        onSubmit={publish}
      >
        <div className="min-w-0 space-y-9">
          <CatalogPicker
            userId={user!.id}
            selectedId={cardId}
            onSelect={(id) => {
              setCardId(id);
              clearError('card');
            }}
            error={errors.card}
          />
          <section
            aria-labelledby="conditions-heading"
            className="space-y-5 border-t border-border pt-7"
          >
            <h2 id="conditions-heading" className="font-display text-3xl font-semibold">
              Condições do lote
            </h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                htmlFor="create-startingBid"
                label="Lance inicial (R$)"
                error={errors.startingBid}
              >
                <Input
                  id="create-startingBid"
                  inputMode="decimal"
                  value={startingBid}
                  onChange={(event) => {
                    setStartingBid(event.target.value);
                    clearError('startingBid');
                  }}
                  aria-invalid={Boolean(errors.startingBid)}
                  aria-describedby={errors.startingBid ? 'create-startingBid-error' : undefined}
                  required
                />
              </Field>
              <Field
                htmlFor="create-increment"
                label="Incremento mínimo (R$)"
                hint="Diferença mínima entre os lances."
                error={errors.increment}
              >
                <Input
                  id="create-increment"
                  inputMode="decimal"
                  value={increment}
                  onChange={(event) => {
                    setIncrement(event.target.value);
                    clearError('increment');
                  }}
                  aria-invalid={Boolean(errors.increment)}
                  aria-describedby={
                    errors.increment ? 'create-increment-error' : 'create-increment-hint'
                  }
                  required
                />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Quando começa?</legend>
              <div className="flex flex-wrap gap-x-7 gap-y-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="start-mode"
                    checked={startImmediately}
                    onChange={() => {
                      setStartImmediately(true);
                      clearError('startsAt');
                    }}
                    className="size-4 accent-primary"
                  />
                  Começar agora
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="start-mode"
                    checked={!startImmediately}
                    onChange={() => {
                      setStartImmediately(false);
                      clearError('startsAt');
                    }}
                    className="size-4 accent-primary"
                  />
                  Agendar início
                </label>
              </div>
            </fieldset>
            <div className="grid gap-5 sm:grid-cols-2">
              {!startImmediately && (
                <Field
                  htmlFor="create-startsAt"
                  label="Data e hora de início"
                  error={errors.startsAt}
                >
                  <Input
                    id="create-startsAt"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(event) => {
                      setStartsAt(event.target.value);
                      clearError('startsAt');
                    }}
                    aria-invalid={Boolean(errors.startsAt)}
                    aria-describedby={errors.startsAt ? 'create-startsAt-error' : undefined}
                    required
                  />
                </Field>
              )}
              <Field
                htmlFor="create-endsAt"
                label="Data e hora de encerramento"
                error={errors.endsAt}
              >
                <Input
                  id="create-endsAt"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => {
                    setEndsAt(event.target.value);
                    clearError('endsAt');
                  }}
                  aria-invalid={Boolean(errors.endsAt)}
                  aria-describedby={errors.endsAt ? 'create-endsAt-error' : undefined}
                  required
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              Horários no fuso do seu navegador: {timezone}. Lances nos instantes finais podem
              prorrogar o encerramento.
            </p>
          </section>
        </div>

        <aside
          className="rounded-lg border border-border bg-card p-6 lg:sticky lg:top-6"
          aria-labelledby="review-heading"
        >
          <h2 id="review-heading" className="font-display text-3xl font-semibold">
            Revise seu leilão
          </h2>
          {details.isError && (
            <div role="alert" className="mt-5 space-y-3">
              <p>{errorMessage(details.error)}</p>
              <Button type="button" variant="outline" onClick={() => void details.refetch()}>
                Tentar carregar a carta novamente
              </Button>
            </div>
          )}
          {cardId && details.isPending ? (
            <CardPreviewSkeleton />
          ) : selected ? (
            <div className="mt-6 flex items-center gap-5 border-b border-border pb-6">
              <CardArtwork
                priority
                src={mediaUrl(selected.previewImageUrl, apiClient.origin)}
                alt={`${selected.title}, ${selected.setName}`}
                className="h-36 min-h-0 w-24 shrink-0 p-0"
              />
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold">{selected.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selected.setName} / {selected.cardNumber}
                </p>
                <p className="mt-2 text-sm">{selected.rarity}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selected.types?.join(', ')}
                  {selected.hp !== undefined ? ` · ${selected.hp} HP` : ''}
                </p>
              </div>
            </div>
          ) : (
            <div className="my-6 flex min-h-40 items-center justify-center rounded-md border border-dashed border-input p-5 text-center text-muted-foreground">
              A carta selecionada aparecerá aqui.
            </div>
          )}
          <dl className="my-6 space-y-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Lance inicial</dt>
              <dd className="text-lg font-semibold">
                {startingCents === null ? 'Informe um valor' : formatMoney(startingCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Incremento mínimo</dt>
              <dd>{incrementCents === null ? 'Informe um valor' : formatMoney(incrementCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Início</dt>
              <dd className="text-right">
                {startImmediately ? (
                  <StatusBadge tone="success">Ao publicar</StatusBadge>
                ) : Number.isFinite(new Date(startsAt).getTime()) ? (
                  new Date(startsAt).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                ) : (
                  'Defina o horário'
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Encerramento</dt>
              <dd className="text-right">
                {Number.isFinite(endDate.getTime())
                  ? endDate.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                  : 'Defina o horário'}
              </dd>
            </div>
          </dl>
          <p className="border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
            Depois de publicado, o lote não pode ser editado. Você pode cancelá-lo enquanto não
            houver lances.
          </p>
          {errors.form && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {errors.form}
            </p>
          )}
          <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>
            Publicar leilão
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            O título, os atributos e a imagem serão preservados no lote.
          </p>
        </aside>
      </form>
    </section>
  );
}
