import { Link } from 'react-router-dom';

import { buttonVariants } from '../../components/ui/button';

export function NotFoundView() {
  return (
    <section className="mx-auto max-w-xl py-16 text-center">
      <p className="font-display text-8xl text-foreground">404</p>
      <h1 className="mt-5">Este lote não está nesta página</h1>
      <p className="my-6 text-muted-foreground">
        Confira o endereço ou volte para os leilões disponíveis.
      </p>
      <Link to="/auctions" className={buttonVariants()}>
        Explorar leilões
      </Link>
    </section>
  );
}
