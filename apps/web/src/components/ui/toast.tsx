// Adapted from shadcn/ui (MIT), Base UI edition. See THIRD_PARTY_NOTICES.
import { Toast } from '@base-ui/react/toast';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

const manager = Toast.createToastManager();

function add(type: string, title: string, description?: string) {
  manager.add({ type, title, description, timeout: type === 'error' ? 8000 : 5000 });
}

export const toast = {
  success: (title: string, description?: string) => add('success', title, description),
  error: (title: string, description?: string) => add('error', title, description),
  info: (title: string, description?: string) => add('info', title, description),
};

function ToastList() {
  const { toasts } = Toast.useToastManager();

  return toasts.map((item) => (
    <Toast.Root
      key={item.id}
      toast={item}
      className={cn(
        'pointer-events-auto relative flex w-full gap-3 rounded-md border border-l-4 bg-card p-4 shadow-xl data-limited:hidden',
        item.type === 'error'
          ? 'border-l-destructive'
          : item.type === 'success'
            ? 'border-l-success'
            : 'border-l-info',
      )}
    >
      <Toast.Content className="flex flex-1 items-start gap-3">
        {item.type === 'success' ? (
          <CheckCircle2 aria-hidden="true" className="mt-1 size-5 shrink-0 text-success" />
        ) : item.type === 'error' ? (
          <TriangleAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-destructive" />
        ) : (
          <Info aria-hidden="true" className="mt-1 size-5 shrink-0 text-info" />
        )}
        <div className="min-w-0">
          <Toast.Title className="font-sans text-base font-semibold leading-snug" />
          <Toast.Description className="mt-1 text-sm text-muted-foreground" />
        </div>
      </Toast.Content>
      <Toast.Close
        aria-label="Fechar notificação"
        className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
      >
        <X className="size-4" />
      </Toast.Close>
    </Toast.Root>
  ));
}

export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={manager} limit={2}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
