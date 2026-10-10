// Copies the plain-SQL migrations next to the compiled runner so `dist` is self-contained.
// The runner finds them with `new URL('./migrations/', import.meta.url)` from both src and dist.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/migrations/', import.meta.url));
const dest = fileURLToPath(new URL('../dist/migrations/', import.meta.url));

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
