import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { CardArtwork } from '../../components/shared/card-artwork';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';

type LoginErrors = { email?: string; password?: string; form?: string };

export function LoginView() {
  const navigate = useNavigate();
  const { cards, login } = useDemo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [simulateError, setSimulateError] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const featuredCard = cards.find((card) => card.name === 'Charizard') ?? cards[0];

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: LoginErrors = {};

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = 'Informe um e-mail válido, como voce@exemplo.com.';
    }

    if (password.length < 10 || password.length > 128) {
      nextErrors.password = 'A senha deve ter entre 10 e 128 caracteres.';
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 400));

      if (!isMounted.current) {
        return;
      }

      if (simulateError) {
        setErrors({ form: 'E-mail ou senha incorretos. Confira os dados e tente novamente.' });
        toast.error('Não foi possível entrar', 'Prévia de uma recusa de autenticação.');

        return;
      }

      login('bidder', normalizedEmail.split('@')[0]);
      setPassword('');
      toast.success(
        'Demonstração iniciada',
        'Você pode explorar os leilões e os lances simulados.',
      );
      navigate('/auctions');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tente novamente em instantes.';

      setErrors({ form: message });
      toast.error('Não foi possível entrar', message);
    } finally {
      if (isMounted.current) {
        setSubmitting(false);
      }
    }
  }

  return (
    <section className="mx-auto grid max-w-5xl gap-10 py-6 sm:py-12 lg:grid-cols-[1fr_0.95fr] lg:gap-20">
      <div className="mx-auto w-full max-w-md self-center">
        <Link
          to="/auctions"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Voltar aos leilões
        </Link>
        <h1 className="mt-8 font-display text-5xl font-semibold leading-none sm:text-6xl">
          Entre na disputa.
        </h1>
        <p className="mt-4 max-w-sm text-lg leading-relaxed text-muted-foreground">
          Acompanhe seus lances, sua coleção e o próximo lote que pode ser seu.
        </p>

        <form className="mt-8 space-y-5" noValidate onSubmit={handleSubmit} aria-busy={submitting}>
          {errors.form && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {errors.form}
            </div>
          )}
          <Field htmlFor="login-email" label="E-mail" error={errors.email}>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
              required
            />
          </Field>
          <Field htmlFor="login-password" label="Senha" error={errors.password}>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                placeholder="Sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                className="pr-24"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute inset-y-0 right-1 my-auto h-9"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={submitting}
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </Button>
            </div>
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            {submitting ? 'Entrando…' : 'Entrar'}
          </Button>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Esta é uma prévia. Use um e-mail e uma senha fictícios; nenhuma credencial será enviada
            ou salva.
          </p>
          <details className="border-t border-border pt-4 text-sm text-muted-foreground">
            <summary className="w-fit cursor-pointer rounded-sm py-1 underline-offset-4 hover:text-foreground hover:underline">
              Estado da demonstração
            </summary>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-foreground">
              <input
                type="checkbox"
                checked={simulateError}
                onChange={(event) => setSimulateError(event.target.checked)}
                disabled={submitting}
                className="size-4 accent-primary"
              />
              Simular recusa ao entrar
            </label>
          </details>
        </form>

        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-6 text-sm">
          <span className="text-muted-foreground">Primeiro lance por aqui?</span>
          <Link
            to="/register"
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
              className: 'text-foreground underline underline-offset-4',
            })}
          >
            Criar conta
          </Link>
        </div>
      </div>

      {featuredCard && (
        <aside
          className="hidden self-center border-l border-border pl-12 lg:block"
          aria-label="Carta do catálogo"
        >
          <div className="bg-muted px-10 py-8">
            <CardArtwork
              src={featuredCard.image}
              alt={`${featuredCard.name}, ${featuredCard.edition}`}
              className="mx-auto max-w-[245px]"
            />
          </div>
          <div className="mt-5 flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-3xl font-semibold">{featuredCard.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{featuredCard.edition}</p>
            </div>
            <span className="pt-2 text-sm text-muted-foreground">Carta {featuredCard.number}</span>
          </div>
          <p className="mt-6 max-w-xs border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
            Cada carta tem uma história. Cada lance fica registrado.
          </p>
        </aside>
      )}
    </section>
  );
}
