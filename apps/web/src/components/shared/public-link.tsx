import { useId, useState } from 'react';

import { Button } from '../ui/button';
import { Field, Input } from '../ui/input';
import { toast } from '../ui/toast';

export async function copyPublicLink(url: string, clipboard?: Pick<Clipboard, 'writeText'>) {
  try {
    if (!clipboard) {
      return false;
    }

    await clipboard.writeText(url);

    return true;
  } catch {
    return false;
  }
}

export function PublicLink({
  path,
  label = 'Copiar link público',
}: {
  path: string;
  label?: string;
}) {
  const [manual, setManual] = useState(false);
  const id = useId();
  const url = typeof window === 'undefined' ? '' : new URL(path, window.location.origin).href;

  async function copy() {
    if (await copyPublicLink(url, navigator.clipboard)) {
      setManual(false);
      toast.success('Link público copiado', 'Este endereço pode ser aberto sem entrar na conta.');
    } else {
      setManual(true);
      toast.info('Copie o link abaixo', 'Seu navegador não permitiu a cópia automática.');
    }
  }

  return (
    <div className="space-y-3 print:hidden">
      <Button variant="outline" onClick={() => void copy()}>
        {label}
      </Button>
      {manual && (
        <Field htmlFor={id} label="Link público" hint="Selecione e copie este endereço.">
          <Input id={id} readOnly value={url} onFocus={(event) => event.target.select()} />
        </Field>
      )}
    </div>
  );
}
