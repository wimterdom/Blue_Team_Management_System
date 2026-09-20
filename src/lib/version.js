import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let v = '0.0.0';
try {
  v = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')).version;
} catch { /* 讀不到就沿用預設 */ }

export const version = v;
export default version;
