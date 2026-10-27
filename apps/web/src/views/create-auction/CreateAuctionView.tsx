import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';
import { formatMoney, parseMoney } from '../../lib/format';

type CreateErrors = Partial<
  Record<'card' | 'startingBid' | 'increment' | 'startsAt' | 'endsAt' | 'form', string>
>;

function localDateTime(offsetMinutes: number) {
  const date = new Date(Date.now() + offsetMinutes * 60_000);

  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());

  return date.toISOString().slice(0, 16);
}

export function CreateAuctionView() {
  const navigate = useNavigate();
  const { cards, user, createAuction } = useDemo();
  const [query, setQuery] = useState('');
  const [cardId, setCardId] = useState('');
  const [startingBid, setStartingBid] = useState('100,00');
  const [increment, setIncrement] = useState('10,00');
  const [startImmediately, setStartImmediately] = useState(true);
  const [startsAt, setStartsAt] = useState(() => localDateTime(30));
  const [endsAt, setEndsAt] = useState(() => localDateTime(180));
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [errors, setErrors] = useState<CreateErrors>({});
  const selected = cards.find((card) => card.id === cardId);
  const search = query.trim().toLocaleLowerCase('pt-BR');
  const results = cards.filter((card) =>
    `${card.name} ${card.edition} ${card.number}`.toLocaleLowerCase('pt-BR').includes(search),
  );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startingCents = parseMoney(startingBid);
  const incrementCents = parseMoney(increment);
  const endDate = new Date(endsAt);

  function clearError(field: keyof CreateErrors) {
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: CreateErrors = {};
    const startDate = startImmediately ? new Date() : new Date(startsAt);

    if (!selected?.image) {
      nextErrors.card = 'Selecione uma carta com imagem para criar o lote.';
    }

    if (startingCents === null || startingCents > 100_000_000) {
      nextErrors.startingBid = 'Informe um valor de R$ 0,01 a R$ 1.000.000,00, como 100,00.';
    }

    if (incrementCents === null || incrementCents > 100_000_000) {
      nextErrors.increment = 'Informe um incremento de R$ 0,01 a R$ 1.000.000,00, como 10,00.';
    }

    if (
      !Number.isFinite(startDate.getTime()) ||
      (!startImmediately && startDate.getTime() <= Date.now())
    ) {
      nextErrors.startsAt = 'Escolha um horário futuro ou use “Começar agora”.';
    }

    if (
      !Number.isFinite(endDate.getTime()) ||
      endDate.getTime() <= Math.max(Date.now(), startDate.getTime())
    ) {
      nextErrors.endsAt = 'O encerramento deve ser futuro e acontecer depois do início.';
    }

    setErrors(nextErrors);

    if (
      Object.keys(nextErrors).length > 0 ||
      !selected ||
      startingCents === null ||
      incrementCents === null
    ) {
      const firstError = Object.keys(nextErrors)[0];

      document.getElementById(`create-${firstError === 'card' ? 'search' : firstError}`)?.focus();

      return;
    }

    try {
      createAuction({
        cardId: selected.id,
        startingBidCents: startingCents,
        incrementCents,
        startsAt: startDate.toISOString(),
        endsAt: endDate.toISOString(),
      });
      toast.success(
        'Leilão publicado na demonstração',
        `${selected.name} já aparece em seus lotes.`,
      );
      navigate('/my-auctions');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Confira os dados e tente novamente.';

      setErrors({ form: message });
      toast.error('Leilão não publicado', message);
    }
  }

  if (user?.role !== 'auctioneer') {
    return (
      <section className="space-y-8">
        <PageHeader title="Criar leilão" />
        <EmptyState
          title="Publique como leiloeiro"
          description="Entre com uma conta de leiloeiro para publicar."
          action={
            <Link to="/login" className="text-link">
              Entrar na minha conta
            </Link>
          }
        />
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
          <section aria-labelledby="choose-card-heading" className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="choose-card-heading" className="font-display text-3xl font-semibold">
                Escolha a carta
              </h2>
              <span className="text-sm text-muted-foreground">Catálogo de demonstração TCGdex</span>
            </div>
            <Field
              htmlFor="create-search"
              label="Buscar carta"
              hint="Busque por nome, coleção ou número. Os nomes do catálogo estão em inglês."
              error={errors.card}
            >
              <Input
                id="create-search"
                type="search"
                value={query}
                placeholder="Ex.: Charizard, Base Set ou 4"
                onChange={(event) => setQuery(event.target.value)}
                aria-invalid={Boolean(errors.card)}
                aria-describedby={errors.card ? 'create-search-error' : 'create-search-hint'}
              />
            </Field>
            {catalogUnavailable ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-5" role="status">
                <h3 className="font-semibold">O catálogo está indisponível</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Não foi possível buscar novas cartas. Os lotes já publicados continuam
                  disponíveis.
                </p>
                <Button
                  type="button"
                  className="mt-4"
                  variant="outline"
                  onClick={() => {
                    setCatalogUnavailable(false);
                    toast.info('Catálogo de demonstração disponível');
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : results.length === 0 ? (
              <EmptyState
                title="Nenhuma carta encontrada"
                description="Tente outro nome, coleção ou número."
                action={
                  <Button type="button" variant="outline" onClick={() => setQuery('')}>
                    Limpar busca
                  </Button>
                }
              />
            ) : (
              <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                role="group"
                aria-label="Cartas disponíveis"
              >
                {results.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    aria-pressed={selected?.id === card.id}
                    className={`flex min-w-0 flex-col items-start rounded-lg border p-3 text-left transition-colors ${selected?.id === card.id ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-input'}`}
                    onClick={() => {
                      setCardId(card.id);
                      setErrors((current) => ({ ...current, card: undefined }));
                    }}
                  >
                    <CardArtwork
                      src={card.image}
                      alt={`${card.name}, ${card.edition}`}
                      className="mx-auto mb-3 h-40 min-h-0 w-full max-w-28 p-0"
                    />
                    <span className="font-semibold">{card.name}</span>
                    <span className="mt-0.5 text-xs text-muted-foreground">
                      {card.edition} / {card.number}
                    </span>
                    {selected?.id === card.id && (
                      <span className="mt-2 text-xs font-semibold text-foreground">
                        Carta selecionada
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <details className="text-sm text-muted-foreground">
              <summary className="w-fit cursor-pointer py-2">Estado da demonstração</summary>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={catalogUnavailable}
                  onChange={(event) => setCatalogUnavailable(event.target.checked)}
                />
                Simular catálogo indisponível
              </label>
            </details>
          </section>

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
          {selected ? (
            <div className="mt-6 flex items-center gap-5 border-b border-border pb-6">
              <CardArtwork
                src={selected.image}
                alt={`${selected.name}, ${selected.edition}`}
                className="h-36 min-h-0 w-24 shrink-0 p-0"
              />
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold">{selected.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selected.edition} / {selected.number}
                </p>
                <p className="mt-2 text-sm">{selected.rarity}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selected.types.join(', ')} · {selected.hp} HP
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
          <Button type="submit" size="lg" className="mt-6 w-full">
            Publicar leilão
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Publicação apenas nesta demonstração.
          </p>
        </aside>
      </form>
    </section>
  );
}
