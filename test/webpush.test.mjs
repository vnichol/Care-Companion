// Checks our push encryption against the reference decoder (http_ece) and the
// VAPID signature against Node's own crypto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, verify, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { encryptPayload, vapidHeader, b64u } from '../src/webpush.js';

test('payload decrypts with the reference implementation', async () => {
  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const authSecret = randomBytes(16);
  const message = JSON.stringify({ title: '💊 8:00 AM medication', body: 'Ondansetron 8 mg — take with food' });

  const body = await encryptPayload(message, b64u.encode(receiver.getPublicKey()), b64u.encode(authSecret));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: receiver, authSecret });
  assert.equal(plain.toString('utf8'), message);
});

test('VAPID header carries a valid ES256 signature', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env = {
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    VAPID_PUBLIC_KEY: b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey)),
    VAPID_SUBJECT: 'https://example.com',
  };
  const header = await vapidHeader('https://web.push.apple.com/abc123', env);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, env.VAPID_PUBLIC_KEY);

  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(b64u.decode(c)).toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://example.com');
  assert.ok(claims.exp > Date.now() / 1000);

  const pub = createPublicKey({ key: await crypto.subtle.exportKey('jwk', pair.publicKey), format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64u.decode(s))));
});
