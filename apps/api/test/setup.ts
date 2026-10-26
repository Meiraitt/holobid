import 'reflect-metadata';
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'false';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.PORT = '3000';

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/main';
process.env.AUDIT_DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/audit';

// Public test-only key, never used outside isolated tests.
process.env.JWT_SECRET = Buffer.alloc(32, 7).toString('base64url');
process.env.AUDIT_HMAC_SECRET = Buffer.alloc(32, 8).toString('base64url');
process.env.AUDIT_PSEUDONYM_SECRET = Buffer.alloc(32, 9).toString('base64url');
process.env.AUDIT_KEY_ID = 'v1';
