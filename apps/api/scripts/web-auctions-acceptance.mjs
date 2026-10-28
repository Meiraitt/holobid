import process from 'node:process';

import { runtime } from './http-runtime.mjs';

const h = await runtime();

try {
  await h.boot();

  const output = await h.command(
    'npm',
    [
      'run',
      process.argv[2] === '--realtime' ? 'test:realtime' : 'test:auctions',
      '--workspace=@holobid/web',
    ],
    undefined,
    {
      HOLOBID_WEB_API_URL: `http://127.0.0.1:${h.env.PORT}`,
      HOLOBID_WEB_TEST_ORIGIN: h.env.WEB_ORIGIN,
      ...(process.argv[2] === '--realtime' ? { JWT_SECRET: h.env.JWT_SECRET } : {}),
    },
  );

  process.stdout.write(output);
} finally {
  await h.close();
}
