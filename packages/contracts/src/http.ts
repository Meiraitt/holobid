export interface ApiErrorDetails {
  fieldErrors?: Record<string, string[]>;
  minimumBidCents?: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: ApiErrorDetails;
  requestId: string;
}
