import './landing.css';

import { Check, ChevronDown, Clock3, FileCheck2, ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';

import { buttonVariants } from '../../components/ui/button';
import { useAuth } from '../../providers/auth-provider';

import { CollectionIllustration } from './collection-illustration';

const questions = [
  {
    question: 'Preciso criar uma conta para explorar?',
    answer:
      'Você pode visitar os leilões, acompanhar o histórico e consultar auditorias e comprovantes públicos sem entrar. Para adicionar saldo e dar lances, crie sua conta de participante.',
  },
  {
    question: 'Como funciona o saldo?',
    answer:
      'O HoloBid é um projeto demonstrativo: depósitos e valores são simulados, sem cobrança ou entrega de cartas físicas. Durante a disputa, o valor do seu lance fica reservado enquanto você lidera. Se alguém superar seu lance, a reserva é liberada. Se vencer, o valor é debitado no encerramento.',
  },
  {
    question: 'O que acontece com um lance perto do fim?',
    answer:
      'Um lance aceito nos últimos dois minutos leva o encerramento para dois minutos após esse lance. Assim, os outros participantes têm tempo para responder. O contador da sala acompanha o novo horário.',
  },
  {
    question: 'Quem pode publicar um lote?',
    answer:
      'A publicação é feita pelas contas de leiloeiro. Elas selecionam uma carta no catálogo TCGdex, definem os valores e o período do leilão e acompanham os resultados. Contas criadas pelo cadastro participam dos lances; leiloeiros não podem dar lances.',
  },
];

export function LandingView() {
  const { user } = useAuth();

  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-heading">
        <div className="landing-hero-copy">
          <p className="landing-intro">Leilões de cartas Pokémon</p>
          <h1 id="landing-heading">Sua próxima carta começa com um lance.</h1>
          <p className="landing-lead">
            Explore os lotes, entre na disputa e acompanhe cada lance ao vivo. Uma casa de leilões
            feita para quem vê uma história em cada carta.
          </p>
          <div className="landing-actions">
            <Link className={buttonVariants({ size: 'lg' })} to="/auctions">
              Explorar leilões
            </Link>
            <a className="landing-secondary-link" href="#como-funciona">
              Como funciona
              <ChevronDown size={18} aria-hidden="true" />
            </a>
          </div>
          <div className="landing-hero-note">
            <ScanLine size={20} aria-hidden="true" />
            <span>Histórico público, do primeiro lance ao arremate.</span>
          </div>
        </div>
        <CollectionIllustration />
      </section>

      <section id="como-funciona" className="landing-process" aria-labelledby="process-heading">
        <div className="landing-section-heading">
          <h2 id="process-heading">Da descoberta ao arremate.</h2>
          <p>Você acompanha o caminho inteiro, com as regras de cada lote sempre à vista.</p>
        </div>
        <ol className="landing-steps">
          <li>
            <span className="landing-step-number" aria-hidden="true">
              1
            </span>
            <h3>Encontre a sua carta</h3>
            <p>
              Veja os lotes em andamento, os próximos leilões e os resultados. Confira a carta, o
              lance mínimo e o horário antes de participar.
            </p>
          </li>
          <li>
            <span className="landing-step-number" aria-hidden="true">
              2
            </span>
            <h3>Entre na disputa</h3>
            <p>
              Crie sua conta, adicione saldo simulado à carteira e dê seu lance. Seu saldo fica
              reservado enquanto você lidera e é liberado quando seu lance é superado.
            </p>
          </li>
          <li>
            <span className="landing-step-number" aria-hidden="true">
              3
            </span>
            <h3>Acompanhe o resultado</h3>
            <p>
              Veja a disputa em tempo real. Ao vencer, encontre o arremate em Meus lances e
              compartilhe o comprovante público com o resultado e sua verificação.
            </p>
          </li>
        </ol>
        <p className="landing-timing-note">
          <Clock3 size={20} aria-hidden="true" />
          Nos últimos dois minutos, cada lance aceito renova o prazo para dois minutos.
        </p>
      </section>

      <section className="landing-audit" aria-labelledby="audit-heading">
        <div className="landing-audit-copy">
          <FileCheck2 size={32} strokeWidth={1.5} aria-hidden="true" />
          <h2 id="audit-heading">O resultado tem uma história. E você pode conferir.</h2>
          <p>
            Cada lance aceito faz parte de uma sequência de registros. A auditoria pública verifica
            essa sequência e informa se encontrou inconsistências.
          </p>
          <p>
            Você encontra o acesso no histórico da sala. Depois do arremate, o comprovante reúne o
            resultado e a verificação em um link que pode ser compartilhado.
          </p>
          <Link className="text-link" to="/auctions?status=ended">
            Consultar leilões encerrados
          </Link>
        </div>
        <div className="landing-record" role="group" aria-label="Etapas de consulta do histórico">
          <div className="landing-record-heading">
            <span>Do lance ao comprovante</span>
            <ScanLine size={23} aria-hidden="true" />
          </div>
          <ol className="landing-record-list">
            <li>
              <span className="landing-record-marker">
                <Check size={16} aria-hidden="true" />
              </span>
              <div>
                <h3>Lance registrado</h3>
                <p>Valor e momento da participação</p>
              </div>
            </li>
            <li>
              <span className="landing-record-marker">
                <Check size={16} aria-hidden="true" />
              </span>
              <div>
                <h3>Sequência verificada</h3>
                <p>Consulta pública da integridade do histórico</p>
              </div>
            </li>
            <li>
              <span className="landing-record-marker">
                <FileCheck2 size={16} aria-hidden="true" />
              </span>
              <div>
                <h3>Arremate documentado</h3>
                <p>Comprovante disponível ao fim da disputa</p>
              </div>
            </li>
          </ol>
          <p className="landing-record-footnote">
            A verificação pode ser consultada sem uma conta.
          </p>
        </div>
      </section>

      <section className="landing-questions" aria-labelledby="questions-heading">
        <div>
          <h2 id="questions-heading">Antes do seu primeiro lance.</h2>
          <p>O essencial para entrar na sala sabendo como a disputa funciona.</p>
        </div>
        <div className="landing-question-list">
          {questions.map(({ question, answer }) => (
            <details key={question}>
              <summary>
                {question}
                <ChevronDown size={20} aria-hidden="true" />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-start" aria-labelledby="start-heading">
        <div>
          <h2 id="start-heading">A próxima disputa está na vitrine.</h2>
          <p>Escolha um lote e conheça o leilão do início ao fim, com saldo simulado.</p>
        </div>
        <Link className={buttonVariants({ size: 'lg' })} to={user ? '/auctions' : '/register'}>
          {user ? 'Ver os leilões' : 'Criar minha conta'}
        </Link>
      </section>
    </div>
  );
}
