import { Body, Controller, Get, HttpStatus, Logger, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsInt, Min } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { HealthService } from '../src/modules/health/health.service';
import { ApiException } from '../src/common/http/api.exception';

class TestInput {
  @IsInt()
  @Min(1)
  amount!: number;
}

// Fixture routes exist only in the test module, never in the application.
@Controller('_test')
class TestController {
  @Post('input')
  input(@Body() body: TestInput): TestInput { return body; }

  @Get('unexpected')
  unexpected(): never { throw new Error('password=private-secret SELECT * FROM users'); }

  @Get('domain')
  domain(): never {
    throw new ApiException(HttpStatus.CONFLICT, 'BID_BELOW_MINIMUM', 'Bid is below the minimum.', { minimumBidCents: 200 });
  }
}

describe('HTTP foundation', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule], controllers: [TestController] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('exposes liveness/readiness and returns a new request ID on every request', async () => {
    const live = await request(app.getHttpServer()).get('/api/v1/health/live').set('X-Request-ID', 'untrusted-value').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    expect(live.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(live.headers['cache-control']).toBe('no-store');
    expect(live.headers['x-powered-by']).toBeUndefined();
    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready' });
    expect(ready.headers['x-request-id']).not.toBe(live.headers['x-request-id']);
  });

  it('returns sanitized readiness failure during shutdown while liveness stays available', async () => {
    const health = app.get(HealthService);
    health.beforeApplicationShutdown();
    try {
      const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body).not.toHaveProperty('stack');
      await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    } finally { health.onApplicationBootstrap(); }
  });

  it('returns a stable public error without echoing the URL or query string', async () => {
    const response = await request(app.getHttpServer()).get('/missing-private-token?secret=value').expect(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Resource not found.', requestId: response.headers['x-request-id'] });
    expect(JSON.stringify(response.body)).not.toContain('private-token');
  });

  it('allows the configured browser origin and rejects other origins', async () => {
    const response = await request(app.getHttpServer()).options('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET').expect(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    const forbidden = await request(app.getHttpServer()).get('/api/v1/health/live').set('Origin', 'https://untrusted.example').expect(403);
    expect(forbidden.body.code).toBe('INVALID_ORIGIN');
    expect(forbidden.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validates DTOs without accepting unknown fields or coercing strings to amounts', async () => {
    await request(app.getHttpServer()).post('/api/v1/_test/input').send({ amount: 2 }).expect(201, { amount: 2 });
    for (const body of [{ amount: '2' }, { amount: 0 }, { amount: 2, role: 'AUCTIONEER', password: 'private-secret' }]) {
      const response = await request(app.getHttpServer()).post('/api/v1/_test/input').send(body).expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.fieldErrors).toBeDefined();
      expect(JSON.stringify(response.body)).not.toContain('private-secret');
      expect(response.body).not.toHaveProperty('target');
    }
  });

  it('normalizes malformed JSON without echoing the raw payload', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/_test/input')
      .set('Content-Type', 'application/json').send('{"password":"private-secret",').expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('private-secret');
  });

  it('rejects oversized JSON bodies with a public 413 response', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/_test/input')
      .send({ password: 'x'.repeat(256 * 1024) }).expect(413);
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('preserves explicit domain details but hides unexpected exceptions', async () => {
    const domain = await request(app.getHttpServer()).get('/api/v1/_test/domain').expect(409);
    expect(domain.body.code).toBe('BID_BELOW_MINIMUM');
    expect(domain.body.details).toEqual({ minimumBidCents: 200 });
    const unexpected = await request(app.getHttpServer()).get('/api/v1/_test/unexpected').expect(500);
    expect(unexpected.body).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId: unexpected.headers['x-request-id'] });
  });

  it('does not log request credentials, payloads, query values or exception messages', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await request(app.getHttpServer()).post('/api/v1/_test/input?token=query-secret')
      .set('Authorization', 'Bearer header-secret').set('Cookie', 'refresh=cookie-secret')
      .send({ amount: 2, password: 'body-secret' }).expect(400);
    await request(app.getHttpServer()).get('/api/v1/_test/unexpected').expect(500);
    const output = JSON.stringify([log.mock.calls, error.mock.calls]);
    expect(output).toContain('http.request');
    expect(output).toContain('http.error');
    for (const secret of ['query-secret', 'header-secret', 'cookie-secret', 'body-secret', 'private-secret', 'SELECT']) {
      expect(output).not.toContain(secret);
    }
  });
});
