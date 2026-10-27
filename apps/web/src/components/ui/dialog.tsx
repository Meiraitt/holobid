// Adapted from shadcn/ui (MIT), Base UI edition. See THIRD_PARTY_NOTICES.
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

import { Button } from './button';

const popupClass =
  'fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-6 text-foreground shadow-2xl outline-none';

function useReturnFocus(open: boolean) {
  const target = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      return;
    }

    const capture = () => {
      const active = document.activeElement;

      if (
        active instanceof HTMLElement &&
        !active.closest('[role="dialog"], [role="alertdialog"]')
      ) {
        target.current = active;
      }
    };

    capture();
    document.addEventListener('focusin', capture);

    return () => document.removeEventListener('focusin', capture);
  }, [open]);

  return () =>
    target.current?.isConnected ? target.current : document.querySelector<HTMLElement>('main');
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const finalFocus = useReturnFocus(open);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/65" />
        <Dialog.Popup className={popupClass} finalFocus={finalFocus}>
          <div className="mb-6 pr-10">
            <Dialog.Title className="font-display text-3xl font-semibold">{title}</Dialog.Title>
            {description && (
              <Dialog.Description className="mt-2 text-muted-foreground">
                {description}
              </Dialog.Description>
            )}
          </div>
          <Dialog.Close
            render={<Button variant="ghost" size="icon" className="absolute right-3 top-3" />}
            aria-label="Fechar diálogo"
          >
            <X />
          </Dialog.Close>
          {children}
          {footer && (
            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t pt-5">{footer}</div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = 'Confirmar',
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  const finalFocus = useReturnFocus(open);

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/65" />
        <AlertDialog.Popup className={popupClass} finalFocus={finalFocus}>
          <AlertDialog.Title className="font-display text-3xl">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <AlertDialog.Close render={<Button variant="outline" />}>Voltar</AlertDialog.Close>
            <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
