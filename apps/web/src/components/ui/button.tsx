// Adapted from shadcn/ui (MIT), Base UI edition. See THIRD_PARTY_NOTICES.
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';

import { cn } from '../../lib/utils';

const buttonStyles = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border border-transparent font-semibold transition-[color,background-color,border-color,box-shadow,translate] duration-200 ease-out motion-safe:active:enabled:translate-y-px motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border-input bg-transparent text-foreground hover:bg-muted',
        secondary: 'bg-muted text-foreground hover:bg-muted/80',
        ghost: 'text-foreground hover:bg-muted',
        destructive:
          'border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20',
      },
      size: {
        default: 'min-h-11 px-5 py-2.5',
        sm: 'min-h-11 px-3 py-2 text-sm',
        lg: 'min-h-12 px-6 py-3 text-lg',
        icon: 'size-11 p-2',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function buttonVariants(props?: Parameters<typeof buttonStyles>[0]) {
  return cn(buttonStyles(props));
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
      )}
      {children}
    </ButtonPrimitive>
  );
}
