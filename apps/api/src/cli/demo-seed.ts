import 'reflect-metadata';
import process from 'node:process';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validateEnvironment } from '../config/environment';
import { DemoCoreModule } from '../modules/demo/demo-core.module';
import { DemoService } from '../modules/demo/demo.service';
async function main() {
  if (process.argv.length !== 2) throw new Error('Unsupported seed arguments.');
  @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.NODE_ENV === 'test', validate: validateEnvironment }), DemoCoreModule] })
  class DemoCliModule {}
  // No HTTP, websocket, auction scheduler or rotation timers in this CLI.
  const app = await NestFactory.createApplicationContext(DemoCliModule, { logger: false, abortOnError: false });
  try { const result = await app.get(DemoService).seed(); process.stdout.write(`${JSON.stringify({ status: 'ready', auctionId: result.auctionId, nextAt: result.nextAt.toISOString() })}\n`); }
  finally { await app.close(); }
}
void main().catch(() => { process.stderr.write('Demo seed failed. Check DEMO_MODE=true, migrations, fixture files and database configuration. Existing activity was not reset.\n'); process.exitCode = 1; });
