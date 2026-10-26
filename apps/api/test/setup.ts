import 'reflect-metadata';
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.PORT = '3000';

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/main';
process.env.AUDIT_DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/audit';
