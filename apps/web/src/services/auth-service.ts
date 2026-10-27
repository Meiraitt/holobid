import type { AuthResponse, AuthUser, CredentialsInput } from '@holobid/contracts';

import type { ApiClient } from './api-client';

export function authService(client: ApiClient) {
  return {
    register: async (input: CredentialsInput) =>
      (await client.request<AuthResponse>('/auth/register', { method: 'POST', body: input })).data,
    login: async (input: CredentialsInput) =>
      (await client.request<AuthResponse>('/auth/login', { method: 'POST', body: input })).data,
    refresh: async () =>
      (await client.request<AuthResponse>('/auth/refresh', { method: 'POST', body: {} })).data,
    logout: async (bearer?: string) => {
      await client.request<void>('/auth/logout', { method: 'POST', body: {}, bearer });
    },
    me: async (signal?: AbortSignal) =>
      (await client.request<AuthUser>('/auth/me', { authenticated: true, signal })).data,
  };
}
