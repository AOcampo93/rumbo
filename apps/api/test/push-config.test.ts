import { createECDH } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { MIN_ADMIN_TOKEN_LENGTH, usableAdminToken } from '../src/push/admin.js';
import { checkVapid } from '../src/push/vapid.js';
import { ADMIN_TOKEN, vapidSettings } from './push-fakes.js';

// Web Push's settings: the VAPID identity (all or nothing, checked when the
// server starts), the reminder delay and the operator's token.

describe('the Web Push settings', () => {
  it('are off by default, with a reminder after 6 hours', () => {
    expect(loadConfig({})).toMatchObject({
      vapidPublicKey: null,
      vapidPrivateKey: null,
      vapidSubject: null,
      pushReminderHours: 6,
      pushRateLimitPerMinute: 20,
      adminToken: null,
      adminRateLimitPerMinute: 5,
    });
    // The empty values of a copied .env.example are the defaults too.
    expect(
      loadConfig({
        VAPID_PUBLIC_KEY: '',
        VAPID_PRIVATE_KEY: '  ',
        VAPID_SUBJECT: '',
        PUSH_REMINDER_HOURS: '',
        ADMIN_TOKEN: '',
      }),
    ).toMatchObject({
      vapidPublicKey: null,
      vapidPrivateKey: null,
      vapidSubject: null,
      pushReminderHours: 6,
      adminToken: null,
    });
  });

  it('are read from the environment, trimmed', () => {
    const vapid = vapidSettings();
    const config = loadConfig({
      VAPID_PUBLIC_KEY: ` ${vapid.vapidPublicKey}\n`,
      VAPID_PRIVATE_KEY: vapid.vapidPrivateKey as string,
      VAPID_SUBJECT: vapid.vapidSubject as string,
      PUSH_REMINDER_HOURS: '1.5',
      PUSH_RATE_LIMIT_PER_MINUTE: '7',
      ADMIN_TOKEN: ` ${ADMIN_TOKEN} `,
      ADMIN_RATE_LIMIT_PER_MINUTE: '2',
    });
    expect(config).toMatchObject({
      ...vapid,
      pushReminderHours: 1.5,
      pushRateLimitPerMinute: 7,
      adminToken: ADMIN_TOKEN,
      adminRateLimitPerMinute: 2,
    });
  });

  it('fall back on the defaults for a number that is not a positive one', () => {
    for (const bad of ['soon', '0', '-3', 'Infinity', 'NaN']) {
      expect(loadConfig({ PUSH_REMINDER_HOURS: bad }).pushReminderHours, bad).toBe(6);
    }
    expect(loadConfig({ PUSH_RATE_LIMIT_PER_MINUTE: '2.5' }).pushRateLimitPerMinute).toBe(20);
    expect(loadConfig({ ADMIN_RATE_LIMIT_PER_MINUTE: '0' }).adminRateLimitPerMinute).toBe(5);
  });
});

describe('checkVapid', () => {
  it('accepts a key pair with an https: or mailto: contact', () => {
    const settings = vapidSettings();
    expect(checkVapid(settings)).toEqual({
      ok: true,
      vapid: {
        publicKey: settings.vapidPublicKey,
        privateKey: settings.vapidPrivateKey,
        subject: settings.vapidSubject,
      },
    });
    expect(checkVapid({ ...settings, vapidSubject: 'mailto:hola@example.org' }).ok).toBe(true);
  });

  it('is off when nothing is set, and says so when only part is', () => {
    const settings = vapidSettings();
    expect(checkVapid({ vapidPublicKey: null, vapidPrivateKey: null, vapidSubject: null })).toEqual(
      { ok: false, reason: 'unset' },
    );
    for (const missing of ['vapidPublicKey', 'vapidPrivateKey', 'vapidSubject'] as const) {
      expect(checkVapid({ ...settings, [missing]: null }), missing).toEqual({
        ok: false,
        reason: 'incomplete',
      });
    }
  });

  it('refuses what the push services would refuse, without echoing the keys', () => {
    const settings = vapidSettings();
    const other = vapidSettings();
    const short = Buffer.alloc(31, 1).toString('base64url');
    const cases: Array<[string, Partial<typeof settings>]> = [
      ['a public key that is not base64url', { vapidPublicKey: `${settings.vapidPublicKey}=` }],
      ['a public key of the wrong size', { vapidPublicKey: short }],
      ['a private key of the wrong size', { vapidPrivateKey: short }],
      ['a pair that doesn’t match', { vapidPublicKey: other.vapidPublicKey }],
      ['an http: contact', { vapidSubject: 'http://rumbo.example.org' }],
      ['a contact that isn’t an address', { vapidSubject: 'rumbo' }],
    ];
    for (const [what, change] of cases) {
      const result = checkVapid({ ...settings, ...change });
      expect(result, what).toEqual({ ok: false, reason: 'invalid' });
      expect(JSON.stringify(result)).not.toContain(settings.vapidPrivateKey as string);
    }
  });

  it('accepts a private key that starts with zero bytes, as 32 bytes', () => {
    const privateKey = Buffer.concat([Buffer.alloc(3), Buffer.alloc(29, 5)]);
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(privateKey);
    const settings = {
      vapidPublicKey: curve.getPublicKey().toString('base64url'),
      vapidSubject: 'https://rumbo.example.org',
    };
    expect(checkVapid({ ...settings, vapidPrivateKey: privateKey.toString('base64url') }).ok).toBe(
      true,
    );
    // Without the padding it is 29 bytes, which web-push (and the push services) refuse.
    expect(
      checkVapid({ ...settings, vapidPrivateKey: privateKey.subarray(3).toString('base64url') }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('the operator’s token', () => {
  it(`is used from ${MIN_ADMIN_TOKEN_LENGTH} characters on`, () => {
    expect(usableAdminToken(null)).toBeNull();
    expect(usableAdminToken('short')).toBeNull();
    expect(usableAdminToken('x'.repeat(MIN_ADMIN_TOKEN_LENGTH - 1))).toBeNull();
    expect(usableAdminToken(ADMIN_TOKEN)).toBe(ADMIN_TOKEN);
  });
});
