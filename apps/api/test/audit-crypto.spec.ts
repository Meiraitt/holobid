import { ConfigService } from '@nestjs/config';
import { AuditCrypto } from '../src/modules/audit/audit-crypto.service';
import { validateEnvironment } from '../src/config/environment';

const env = { NODE_ENV: 'test', WEB_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'postgresql://test@localhost/main',
  AUDIT_DATABASE_URL: 'postgresql://test@localhost/audit', JWT_SECRET: Buffer.alloc(32, 7).toString('base64url'),
  AUDIT_HMAC_SECRET: Buffer.alloc(32, 8).toString('base64url'), AUDIT_PSEUDONYM_SECRET: Buffer.alloc(32, 9).toString('base64url') };

describe('Audit cryptography configuration and canonicalization', () => {
  const crypto = new AuditCrypto(new ConfigService(validateEnvironment(env)));
  it('canonicalizes nested objects while retaining array order and scalar types', () => {
    expect(crypto.digest({ b: 2, a: { y: 1, x: [1, '2'] } })).toBe(crypto.digest({ a: { x: [1, '2'], y: 1 }, b: 2 }));
    expect(crypto.digest([1, '2'])).not.toBe(crypto.digest(['2', 1])); expect(crypto.digest(1)).not.toBe(crypto.digest('1'));
  });
  it('authenticates hashes and rejects altered signatures and invalid lengths', () => {
    const hash = crypto.digest(['example']); const mac = crypto.mac(hash);
    expect(crypto.validMac(hash, mac)).toBe(true); expect(crypto.validMac(crypto.digest(['other']), mac)).toBe(false);
    expect(crypto.validMac(hash, 'a')).toBe(false); expect(crypto.validMac(hash, 'z'.repeat(64))).toBe(false);
  });
  it('scopes deterministic pseudonyms and operation IDs without returning identities', () => {
    expect(crypto.pseudonym('auction', 'user')).toMatch(/^[0-9a-f]{16}$/);
    expect(crypto.pseudonym('auction', 'user')).toBe(crypto.pseudonym('auction', 'user'));
    expect(crypto.pseudonym('auction', 'user')).not.toBe(crypto.pseudonym('other', 'user'));
    const operation = crypto.operationKey('user', 'POST /auctions', 'A');
    expect(operation).toBe(crypto.operationKey('user', 'POST /auctions', 'a'));
    expect(operation).not.toBe(crypto.operationKey('other', 'POST /auctions', 'a'));
    expect(operation).not.toBe(crypto.operationKey('user', 'POST /other', 'a'));
  });
  it('requires independent canonical keys without exposing their values', () => {
    for (const field of ['AUDIT_HMAC_SECRET', 'AUDIT_PSEUDONYM_SECRET']) {
      expect(() => validateEnvironment({ ...env, [field]: 'private-invalid-key' })).toThrow(`Invalid environment configuration: ${field}.`);
      expect(() => validateEnvironment({ ...env, [field]: env.JWT_SECRET })).toThrow(field);
    }
    expect(() => validateEnvironment({ ...env, AUDIT_KEY_ID: '../secret' })).toThrow('AUDIT_KEY_ID');
    expect(validateEnvironment(env).AUDIT_KEY_ID).toBe('v1');
  });
});
