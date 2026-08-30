import { register } from 'node:module';

// Loaded via `node --import` so the alias resolver is installed before the
// test files are loaded. Hooks have to live in their own module because Node
// runs them on a separate thread.
register(new URL('./alias-hooks.mjs', import.meta.url));
