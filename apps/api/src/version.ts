import { readFileSync } from 'node:fs';

/** The API's version. Read at runtime so it works from src/ (tsx) and dist/ (node) alike. */
export const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
