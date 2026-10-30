// Content-hash fingerprints for /static assets: asset('/static/css/site.css') -> '/static/css/site.css?v=<hash>'.
// Files are served with a 1-year immutable cache, so any change gets a new URL.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');
const hashes = new Map();

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else hashes.set('/static/' + relative(staticDir, p).split('\\').join('/'),
      createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 10));
  }
})(staticDir);

export const asset = path => (hashes.has(path) ? `${path}?v=${hashes.get(path)}` : path);
