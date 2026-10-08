// Writes the server's Web Push identity into apps/api/.env without printing it:
// a new VAPID key pair (RFC 8292) and its contact, and with --admin-token also
// the ADMIN_TOKEN that guards POST /v1/admin/push.
//
//   pnpm --filter @rumbo/api run push:keys                  make the key pair, once
//   pnpm --filter @rumbo/api run push:keys --admin-token    also make an ADMIN_TOKEN, if there is none
//   pnpm --filter @rumbo/api run push:keys --replace        replace the key pair
//
// Replacing the pair invalidates every subscription: browsers have to subscribe
// again. Production gets the same values as runtime-only variables in Coolify,
// read from this file and sent through its API (docs/DEPLOY.md), never typed.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const ENV = fileURLToPath(new URL('../.env', import.meta.url));
const SUBJECT = 'https://rumbo.arturoocampo.com';
const flags = new Set(process.argv.slice(2));

let text = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
const valueOf = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';

/** Sets `key=value`, in place when the file already has the key, at the end if not. */
function setValue(key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) text = text.replace(pattern, () => line);
  else text += `${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}

const written = [];
if (valueOf('VAPID_PUBLIC_KEY') || valueOf('VAPID_PRIVATE_KEY')) {
  if (flags.has('--replace')) {
    const pair = webpush.generateVAPIDKeys();
    setValue('VAPID_PUBLIC_KEY', pair.publicKey);
    setValue('VAPID_PRIVATE_KEY', pair.privateKey);
    written.push('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY');
  } else {
    console.log('The VAPID key pair is already in apps/api/.env; --replace makes a new one.');
  }
} else {
  const pair = webpush.generateVAPIDKeys();
  setValue('VAPID_PUBLIC_KEY', pair.publicKey);
  setValue('VAPID_PRIVATE_KEY', pair.privateKey);
  written.push('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY');
}
if (!valueOf('VAPID_SUBJECT')) {
  setValue('VAPID_SUBJECT', SUBJECT);
  written.push('VAPID_SUBJECT');
}
if (flags.has('--admin-token') && !valueOf('ADMIN_TOKEN')) {
  setValue('ADMIN_TOKEN', randomBytes(32).toString('base64url'));
  written.push('ADMIN_TOKEN');
}

if (written.length > 0) {
  writeFileSync(ENV, text, { mode: 0o600 });
  // writeFileSync keeps the mode of a file that already exists.
  chmodSync(ENV, 0o600);
  console.log(`Written to apps/api/.env (not shown): ${written.join(', ')}.`);
}
