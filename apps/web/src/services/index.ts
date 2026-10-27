import { ApiClient } from './api-client';
import { authService } from './auth-service';
import { resourceServices } from './resource-services';

export const apiClient = new ApiClient(import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000');
export const authApi = authService(apiClient);
export const api = resourceServices(apiClient);
