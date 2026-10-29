import { renameSync, writeFileSync } from 'node:fs';

// The compiled API reads this file from another process, including scheduler callbacks.
// Replace it atomically so readers always see one complete configuration.
export function writeHttpControl(path, state) {
  const pending = `${path}.next`;

  writeFileSync(pending, JSON.stringify(state), { mode: 0o600 });
  renameSync(pending, path);
}
