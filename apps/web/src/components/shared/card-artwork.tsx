import { ImageOff, Maximize2 } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Modal } from '../ui/dialog';

export function CardArtwork({
  src,
  alt,
  className,
  zoom = false,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  zoom?: boolean;
  priority?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = !src || failedSource === src;

  return (
    <div
      className={cn(
        'relative flex min-h-64 items-center justify-center rounded-md bg-muted p-6',
        className,
        zoom && 'pb-16',
      )}
    >
      {failed ? (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <ImageOff aria-hidden="true" />
          <span>Imagem indisponível</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          width={245}
          height={337}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          onError={() => setFailedSource(src)}
          className="h-full max-h-full w-full object-contain drop-shadow-lg"
        />
      )}
      {zoom && !failed && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="absolute bottom-2 right-2 bg-muted/90"
            onClick={() => setOpen(true)}
          >
            <Maximize2 />
            Ampliar imagem
          </Button>
          <Modal open={open} onOpenChange={setOpen} title={alt}>
            <img
              src={src}
              alt={alt}
              width={735}
              height={1011}
              decoding="async"
              className="mx-auto max-h-[65dvh] max-w-full object-contain"
            />
          </Modal>
        </>
      )}
    </div>
  );
}
