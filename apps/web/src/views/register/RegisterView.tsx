import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { safeDestination } from '../../auth/navigation';
import { CardArtwork } from '../../components/shared/card-artwork';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';
import { useAuth } from '../../providers/auth-provider';
import { errorMessage } from '../../services/api-error';

type RegisterErrors = { email?: string; password?: string; confirmation?: string; form?: string };

export function RegisterView() {
  const navigate = useNavigate();
  const { cards } = useDemo();
  const { signIn } = useAuth();
  const location = useLocation();
  const returnTo = location.state?.returnTo ?? new URLSearchParams(location.search).get('returnTo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const featuredCard = cards.find((card) => card.name === 'Pikachu') ?? cards[0];

  const isMounted = useRef(true);
  const errorSummary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.form) {
      errorSummary.current?.focus();
    }
  }, [errors.form]);

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
    const nextErrors: RegisterErrors = {};

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = 'Informe um e-mail válido, como voce@exemplo.com.';
    }

    if (password.length < 10) {
      nextErrors.password = 'A senha deve ter pelo menos 10 caracteres';
    } else if (password.length > 128) {
      nextErrors.password = 'A senha deve ter no máximo 128 caracteres.';
    }

    if (confirmation !== password || !confirmation) {
      nextErrors.confirmation = 'As senhas precisam ser iguais.';
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      event.currentTarget
        .querySelector<HTMLInputElement>(`#register-${Object.keys(nextErrors)[0]}`)
        ?.focus();

      return;
    }

    setSubmitting(true);

    try {
      const user = await signIn('register', { email: normalizedEmail, password });

      setPassword('');
      setConfirmation('');
      toast.success('Conta criada', 'Sua conta de licitante está pronta.');
      navigate(safeDestination(returnTo, user.role), { replace: true });
    } catch (error) {
      if (!isMounted.current) {
        return;
      }

      const message = errorMessage(error);

      setErrors({ form: message });
      toast.error('Conta não criada', message);
    } finally {
      if (isMounted.current) {
        setSubmitting(false);
      }
    }
  }

  return (
    <section className="mx-auto grid max-w-5xl gap-10 py-6 sm:py-10 lg:grid-cols-[1fr_0.95fr] lg:gap-20">
      <div className="mx-auto w-full max-w-md">
        <Link
          to="/auctions"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Voltar aos leilões
        </Link>
        <h1 className="mt-8 font-display text-5xl font-semibold leading-none sm:text-6xl">
          Sua coleção começa aqui.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Crie sua conta para participar dos leilões e acompanhar cada lance.
        </p>

        <form className="mt-7 space-y-5" noValidate onSubmit={handleSubmit} aria-busy={submitting}>
          {errors.form && (
            <div
              role="alert"
              tabIndex={-1}
              ref={errorSummary}
              className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {errors.form}
            </div>
          )}
          <Field htmlFor="register-email" label="E-mail" error={errors.email}>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'register-email-error' : undefined}
              required
            />
          </Field>
          <Field
            htmlFor="register-password"
            label="Senha"
            hint="A senha deve ter pelo menos 10 caracteres"
            error={errors.password}
          >
            <div className="relative">
              <Input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Crie uma senha fictícia"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? 'register-password-error' : 'register-password-hint'
                }
                className="pr-24"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute inset-y-0 right-1 my-auto h-9"
                aria-label={showPassword ? 'Ocultar senhas' : 'Mostrar senhas'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={submitting}
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </Button>
            </div>
          </Field>
          <Field
            htmlFor="register-confirmation"
            label="Confirmar senha"
            error={errors.confirmation}
          >
            <Input
              id="register-confirmation"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Repita a senha"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.confirmation)}
              aria-describedby={errors.confirmation ? 'register-confirmation-error' : undefined}
              required
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            {submitting ? 'Criando conta…' : 'Criar conta'}
          </Button>
          <p className="text-sm leading-relaxed text-muted-foreground">
            O cadastro cria uma conta de licitante. Contas de leiloeiro são administradas
            separadamente.
          </p>
        </form>

        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-6 text-sm">
          <span className="text-muted-foreground">Já tem uma conta?</span>
          <Link
            to="/login"
            state={{ returnTo }}
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
              className: 'text-foreground underline underline-offset-4',
            })}
          >
            Entrar
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
          <div className="mt-6 space-y-3 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
            <p>O saldo é simulado. Os lances são parte da experiência.</p>
            <p>Explore cartas, acompanhe a disputa e veja como funciona uma arrematação.</p>
          </div>
        </aside>
      )}
    </section>
  );
}
