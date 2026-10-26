export type UserRole = 'BIDDER' | 'AUCTIONEER';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  expiresIn: 900;
}

export interface CredentialsInput {
  email: string;
  password: string;
}
