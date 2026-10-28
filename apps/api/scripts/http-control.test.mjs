import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import { writeHttpControl } from './http-control.mjs';

test('concurrent fixture readers only observe complete control snapshots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'holobid-control-test-'));
  const path = join(directory, 'control.json');

  writeHttpControl(path, { revision: 0, inverse: 0 });

  const reader = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const { readFileSync } = require('node:fs');
     parentPort.postMessage('ready');
     let reads = 0;
     while (true) {
       const value = JSON.parse(readFileSync(workerData, 'utf8'));
       if (value.revision !== -value.inverse) throw new Error('Mixed snapshot');
       reads++;
       if (value.revision === 5000) break;
     }
     parentPort.postMessage(reads);`,
    { eval: true, workerData: path },
  );

  try {
    await once(reader, 'message');

    const finished = once(reader, 'message');

    for (let revision = 1; revision <= 5000; revision++) {
      writeHttpControl(path, { revision, inverse: -revision });
    }

    const [reads] = await finished;

    assert.ok(reads > 1, 'Reader must overlap configuration updates.');
  } finally {
    await reader.terminate();
    rmSync(directory, { recursive: true, force: true });
  }
});
