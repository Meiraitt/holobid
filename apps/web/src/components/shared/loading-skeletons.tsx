import { LoadingRegion, Skeleton } from '../ui/skeleton';

function TextLines({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div className="w-full max-w-2xl space-y-3">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-6 w-full" />
      </div>
      <Skeleton className="h-11 w-40 shrink-0" />
    </div>
  );
}

export function AuctionGridSkeleton() {
  return (
    <LoadingRegion label="Carregando leilões.">
      <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index}>
            <Skeleton className="h-72 rounded-md" />
            <div className="mt-4 flex items-center justify-between">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="mt-2 h-9 w-2/3" />
            <Skeleton className="mt-1 h-5 w-4/5" />
            <div className="mt-4 space-y-1">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-7 w-28" />
            </div>
            <Skeleton className="mt-3 h-5 w-full" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function CatalogGridSkeleton() {
  return (
    <LoadingRegion label="Buscando cartas…">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="min-w-0 rounded-lg border bg-card p-3">
            <Skeleton className="mx-auto mb-3 h-40 w-full max-w-28" />
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="mt-0.5 h-4 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-5 h-11 w-44" />
    </LoadingRegion>
  );
}

export function CardPreviewSkeleton() {
  return (
    <LoadingRegion label="Carregando detalhes da carta…" className="mt-6 border-b pb-6">
      <div className="flex items-center gap-5">
        <Skeleton className="h-36 w-24 shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-7 w-4/5" />
          <TextLines />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function BidPanelSkeleton({
  label = 'Carregando sua posição e saldo…',
}: {
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="space-y-5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <TextLines />
      </div>
    </LoadingRegion>
  );
}

export function AuctionRoomSkeleton() {
  return (
    <LoadingRegion label="Carregando lote…">
      <div className="space-y-8">
        <Skeleton className="h-11 w-36" />
        <HeaderSkeleton />
        <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="rounded-lg bg-muted px-5 py-7 sm:px-10 sm:py-9 lg:col-span-7">
            <div className="flex h-80 items-center justify-center sm:h-[440px]">
              <Skeleton className="h-4/5 w-1/2 bg-border/40" />
            </div>
          </div>
          <div className="space-y-6 rounded-xl border bg-card p-5 sm:p-7 lg:col-span-5 lg:row-span-2">
            <div className="flex justify-between">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-5 w-32" />
            </div>
            <Skeleton className="h-14 w-3/4" />
            <Skeleton className="h-14 w-1/2" />
            <div className="space-y-5">
              <Skeleton className="h-20" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-5 border-b pb-6 lg:col-span-7">
            {Array.from({ length: 4 }, (_, index) => (
              <TextLines key={index} />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

export function CompactRowsSkeleton({
  label,
  count = 3,
  artwork = false,
}: {
  label: string;
  count?: number;
  artwork?: boolean;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="divide-y border-y">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="flex items-center justify-between gap-4 py-4">
            {artwork && <Skeleton className="h-16 w-12 shrink-0" />}
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-5 w-full" />
            </div>
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function ParticipationListSkeleton() {
  return (
    <LoadingRegion label="Carregando suas participações…">
      <div className="divide-y border-y">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center"
          >
            <div className="flex items-center gap-5">
              <Skeleton className="h-32 w-24 shrink-0" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-7 w-4/5" />
                <TextLines />
              </div>
            </div>
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <TextLines />
                <TextLines />
              </div>
              <Skeleton className="h-5 w-full" />
            </div>
            <Skeleton className="h-11 w-40" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function OwnedAuctionsSkeleton() {
  return (
    <LoadingRegion label="Carregando seus lotes…">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden h-11 bg-muted lg:block" />
        <div className="divide-y">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="grid items-center gap-5 bg-card p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-6"
            >
              <div className="flex items-center gap-4">
                <Skeleton className="h-24 w-16 shrink-0" />
                <div className="flex-1 space-y-3">
                  <TextLines />
                  <Skeleton className="h-6 w-20" />
                </div>
              </div>
              <TextLines />
              <Skeleton className="h-8 w-24 lg:ml-auto" />
              <Skeleton className="h-11 w-36" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function WalletSkeleton() {
  return (
    <LoadingRegion label="Carregando sua carteira…">
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.7fr_1fr] lg:gap-12">
        <div>
          <div className="border-y py-7 sm:py-9">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-2 h-16 w-56" />
            <div className="mt-7 grid grid-cols-2 gap-5 border-t pt-5">
              <TextLines />
              <TextLines />
            </div>
            <Skeleton className="mt-4 h-5 w-full" />
          </div>
          <Skeleton className="mt-9 h-8 w-56" />
          <div className="mt-4 space-y-5 border-y py-6">
            <TextLines />
            <Skeleton className="h-11 w-36" />
          </div>
        </div>
        <div className="space-y-6 bg-muted px-5 py-6 sm:px-6">
          <Skeleton className="h-8 w-3/4 bg-border/40" />
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-3">
              <Skeleton className="h-5 w-2/3 bg-border/40" />
              <Skeleton className="h-14 w-full bg-border/40" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AuditSkeleton() {
  return (
    <LoadingRegion label="Verificando histórico…">
      <div className="space-y-8">
        <div className="border-l-4 bg-card p-6 sm:p-8">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="mt-4 h-9 w-3/5" />
          <TextLines className="mt-3 max-w-2xl" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 3 }, (_, index) => (
              <TextLines key={index} />
            ))}
          </div>
          <Skeleton className="mt-5 h-9 w-40" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-11 w-48" />
        </div>
        <div className="grid gap-5 border-y py-6 sm:grid-cols-3">
          <TextLines />
          <TextLines />
          <TextLines />
        </div>
        <Skeleton className="h-9 w-52" />
        <div className="divide-y rounded-lg border bg-card">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="p-5 sm:p-6">
              <TextLines className="max-w-md" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function ReceiptSkeleton() {
  return (
    <LoadingRegion label="Carregando comprovante…">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="space-y-4 border-b p-6 sm:p-9">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="space-y-8 p-6 sm:p-9">
          <div className="flex items-center gap-6 border-b pb-8 sm:gap-8">
            <Skeleton className="h-40 w-28 shrink-0 sm:h-48 sm:w-32" />
            <div className="w-full space-y-3">
              <Skeleton className="h-10 w-3/4" />
              <TextLines />
            </div>
          </div>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-12 w-48" />
          <div className="grid gap-x-8 gap-y-6 border-y py-7 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <TextLines key={index} />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AuthFormSkeleton({ registration = false }: { registration?: boolean }) {
  return (
    <LoadingRegion label="Verificando sua sessão…">
      <div className="mx-auto grid max-w-5xl gap-10 py-6 sm:py-10 lg:grid-cols-[1fr_0.95fr] lg:gap-20">
        <div className="mx-auto w-full max-w-md">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-8 h-24 w-4/5" />
          <TextLines className="mt-4" />
          <div className="mt-8 space-y-5">
            {Array.from({ length: registration ? 3 : 2 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-11" />
              </div>
            ))}
            <Skeleton className="h-12" />
          </div>
        </div>
        <div className="hidden space-y-6 self-start rounded-lg border bg-card p-8 lg:block">
          <Skeleton className="h-80" />
          <Skeleton className="h-8 w-2/3" />
          <TextLines />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function PrivatePageSkeleton({ pathname }: { pathname: string }) {
  if (pathname === '/wallet') {
    return (
      <section className="mx-auto max-w-5xl py-5 sm:py-8">
        <HeaderSkeleton />
        <WalletSkeleton />
      </section>
    );
  }

  if (pathname === '/auctions/new') {
    return (
      <section className="space-y-8">
        <HeaderSkeleton />
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)] lg:gap-12">
          <div className="space-y-5">
            <Skeleton className="h-9 w-48" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-11" />
              <Skeleton className="h-5 w-64" />
            </div>
            <CatalogGridSkeleton />
          </div>
          <div className="space-y-6 rounded-lg border bg-card p-6">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-40" />
            <TextLines />
            <TextLines />
            <Skeleton className="h-12" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <HeaderSkeleton />
      {pathname === '/my-auctions' ? (
        <>
          <div className="grid gap-6 border-y py-6 sm:grid-cols-[1.4fr_1fr_1fr]">
            <TextLines />
            <TextLines />
            <TextLines />
          </div>
          <Skeleton className="h-11 w-44" />
          <OwnedAuctionsSkeleton />
        </>
      ) : (
        <>
          <div className="flex gap-6 border-b pb-3">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
          <ParticipationListSkeleton />
        </>
      )}
    </section>
  );
}
