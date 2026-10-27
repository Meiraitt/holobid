import { useState } from 'react';

import { AuctionCard } from '../../components/shared/auction-card';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ConfirmationDialog, Modal } from '../../components/ui/dialog';
import { Field, Input, NativeSelect } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';

export function DesignSystemView() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { auctions } = useDemo();

  return (
    <section className="space-y-10">
      <PageHeader
        title="Design system"
        description="A mesma linguagem em cada tela: foco nas cartas, decisões claras e estados legíveis. Experimente também os temas Claro e Escuro pelo botão de sol e lua no topo."
      />
      <section className="border-t pt-7">
        <h2>Cor com propósito</h2>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ['Fundo', 'bg-background'],
            ['Superfície', 'bg-card'],
            ['Ação', 'bg-primary'],
            ['Sucesso', 'bg-success'],
            ['Atenção', 'bg-warning'],
            ['Erro', 'bg-destructive'],
          ].map(([label, color]) => (
            <div key={label}>
              <div className={`h-20 rounded-md border ${color}`} />
              <p className="mt-2 text-sm text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="border-t pt-7">
        <h2>Botões</h2>
        <p className="mt-2 text-muted-foreground">
          Alvos de pelo menos 44px, foco visível e estados consistentes.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            onClick={() =>
              toast.success(
                'Lance de demonstração aceito',
                'A carteira e o estado do lote serão atualizados juntos.',
              )
            }
          >
            Ação principal
          </Button>
          <Button variant="outline" onClick={() => setDialog(true)}>
            Abrir diálogo
          </Button>
          <Button variant="secondary" onClick={() => toast.info('Feedback informativo')}>
            Secundário
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast.error('Não foi possível concluir', 'Revise o valor e tente novamente.')
            }
          >
            Discreto
          </Button>
          <Button variant="destructive" onClick={() => setConfirm(true)}>
            Cancelar lote
          </Button>
          <Button loading>Enviando lance…</Button>
          <Button disabled>Indisponível</Button>
        </div>
      </section>
      <section className="border-t pt-7">
        <h2>Formulários</h2>
        <div className="mt-5 grid gap-6 md:grid-cols-3">
          <Field htmlFor="ds-bid" label="Seu lance (R$)" hint="Mínimo R$ 400,00">
            <Input
              id="ds-bid"
              defaultValue="400,00"
              inputMode="decimal"
              aria-describedby="ds-bid-hint"
            />
          </Field>
          <Field htmlFor="ds-error" label="Valor inválido" error="Informe um valor maior que zero.">
            <Input
              id="ds-error"
              defaultValue="-20,00"
              aria-invalid="true"
              aria-describedby="ds-error-error"
            />
          </Field>
          <Field htmlFor="ds-select" label="Estado do lote">
            <NativeSelect id="ds-select">
              <option>Ao vivo</option>
              <option>Agendado</option>
              <option>Encerrado</option>
            </NativeSelect>
          </Field>
        </div>
      </section>
      <section className="border-t pt-7">
        <h2>Status e feedback</h2>
        <div className="mt-5 flex flex-wrap gap-6">
          <StatusBadge tone="success">Você está ganhando</StatusBadge>
          <StatusBadge tone="warning">Você foi superado</StatusBadge>
          <StatusBadge tone="info">Confirmando resultado</StatusBadge>
          <StatusBadge tone="danger">Integridade comprometida</StatusBadge>
        </div>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          A cor sempre vem acompanhada de texto. Notificações confirmam ações; o resultado também
          permanece visível na tela.
        </p>
      </section>
      <section className="grid gap-8 border-t pt-7 md:grid-cols-2">
        <div>
          <h2 className="mb-5">Card de lote</h2>
          <div className="max-w-xs">{auctions[0] && <AuctionCard auction={auctions[0]} />}</div>
        </div>
        <div>
          <h2 className="mb-5">Superfície de conteúdo</h2>
          <Card>
            <CardHeader>
              <CardTitle>Uma responsabilidade por componente</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Cards, campos, diálogos e notificações compartilham tokens. A vitrine usa cartas;
                carteira e histórico usam dados alinhados, sem transformar cada número em um novo
                card.
              </p>
            </CardContent>
          </Card>
          <div className="mt-6">
            <p className="font-display text-4xl">Barlow Condensed</p>
            <p className="mt-2">Source Sans 3 para informações, controles e valores.</p>
            <p className="mt-2 text-2xl tabular-nums">R$ 1.250,00</p>
          </div>
        </div>
      </section>
      <Modal
        open={dialog}
        onOpenChange={setDialog}
        title="Diálogos com contexto"
        description="Teclado, Escape, foco e temas são tratados pela base compartilhada."
      >
        <p>Use para depósito ou ampliação da carta. Formulários longos têm uma página própria.</p>
        <Button className="mt-6" onClick={() => setDialog(false)}>
          Entendi
        </Button>
      </Modal>
      <ConfirmationDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancelar este lote?"
        description="Exemplo de confirmação para uma ação que muda o estado do lote. Nenhum lote será alterado nesta amostra."
        confirmLabel="Cancelar lote"
        destructive
        onConfirm={() => {
          setConfirm(false);
          toast.info('Exemplo de confirmação concluído');
        }}
      />
    </section>
  );
}
