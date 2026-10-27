import { ApiException } from '../../common/http/api.exception';

export function auditPending() {
  return new ApiException(409, 'AUDIT_PENDING', 'The auction is awaiting audit reconciliation.');
}

export function auditTampered() {
  return new ApiException(409, 'AUDIT_TAMPERED', 'Auction integrity could not be verified.');
}

export function auditUnavailable() {
  return new ApiException(
    503,
    'AUDIT_UNAVAILABLE',
    'Audit verification is temporarily unavailable.',
  );
}
