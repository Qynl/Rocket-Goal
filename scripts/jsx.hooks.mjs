// Lets plain `node` import .jsx sources by transforming them with esbuild
// (esbuild ships with vite). Registered from uitest.mjs before dynamic imports.
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.jsx')) {
    const src = await readFile(new URL(url), 'utf8');
    const result = await transform(src, { loader: 'jsx', format: 'esm', sourcefile: url, jsx: 'automatic' });
    return { format: 'module', shortCircuit: true, source: result.code };
  }
  return next(url, context);
}
