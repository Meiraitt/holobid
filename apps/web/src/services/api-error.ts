import type { ApiError } from '@holobid/contracts';

export type FailureKind = 'http' | 'network' | 'timeout' | 'aborted' | 'protocol';

export class ApiRequestError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly status = 0,
    readonly problem?: ApiError,
    readonly retryAfterMs?: number,
  ) {
    super(problem?.code ?? kind);
    this.name = 'ApiRequestError';
  }
}

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
  EMAIL_ALREADY_EXISTS: 'Este e-mail já está em uso. Entre na sua conta ou use outro e-mail.',
  SESSION_EXPIRED: 'Sua sessão expirou. Entre novamente para continuar.',
  INVALID_REFRESH_TOKEN: 'Sua sessão expirou. Entre novamente para continuar.',
  INVALID_ORIGIN: 'Não foi possível validar a origem da solicitação. Tente recarregar a página.',
  INSUFFICIENT_FUNDS: 'Saldo disponível insuficiente para esta operação.',
};

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return 'Não foi possível concluir. Tente novamente em instantes.';
  }

  if (error.kind === 'timeout') {
    return 'A resposta demorou mais que o esperado. Confira a conexão e tente novamente.';
  }

  if (error.kind === 'network') {
    return 'Não foi possível conectar ao servidor. Confira sua conexão.';
  }

  if (error.kind === 'aborted') {
    return 'Solicitação cancelada.';
  }

  const message = messages[error.problem?.code ?? ''];

  if (message) {
    return message;
  }

  if (error.status === 429) {
    return 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.';
  }

  if (error.status === 401) {
    return 'Entre novamente para continuar.';
  }

  if (error.status === 403) {
    return 'Sua conta não tem permissão para realizar esta ação.';
  }

  if (error.status === 400 || error.status === 422) {
    return 'Confira os dados informados e tente novamente.';
  }

  return 'Não foi possível concluir. Tente novamente em instantes.';
}
