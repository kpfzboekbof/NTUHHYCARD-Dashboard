import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Module resolution for `node --test`, matching what the Next.js bundler does
 * for the application build:
 *
 *  - the `@/*` path alias from tsconfig.json
 *  - extensionless imports (`./expr` → `./expr.ts`)
 *
 * Without these, a test can only import modules that happen to use explicit
 * relative paths with extensions — which is none of the application code.
 */

const projectRoot = new URL('../', import.meta.url);
const tsconfig = JSON.parse(readFileSync(new URL('tsconfig.json', projectRoot), 'utf-8'));
const paths = tsconfig.compilerOptions?.paths ?? {};

/** [prefix, target] pairs from tsconfig, e.g. ['@/', './src/'] */
const aliases = Object.entries(paths)
  .filter(([pattern, targets]) => pattern.endsWith('/*') && targets?.[0]?.endsWith('/*'))
  .map(([pattern, targets]) => [pattern.slice(0, -1), targets[0].slice(0, -1)]);

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** First existing file for a base URL, trying each extension in turn. */
function findFile(base) {
  for (const extension of EXTENSIONS) {
    const candidate = new URL(`${base.href}${extension}`);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return undefined;
}

export function resolve(specifier, context, nextResolve) {
  for (const [prefix, target] of aliases) {
    if (!specifier.startsWith(prefix)) continue;
    const resolved = findFile(new URL(`${target}${specifier.slice(prefix.length)}`, projectRoot));
    if (resolved) return nextResolve(resolved, context);
  }

  if (specifier.startsWith('.') && context.parentURL) {
    const resolved = findFile(new URL(specifier, context.parentURL));
    if (resolved) return nextResolve(resolved, context);
  }

  return nextResolve(specifier, context);
}
