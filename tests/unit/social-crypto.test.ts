import { describe, expect, it } from 'vitest';
import {
  decryptToken,
  encryptToken,
  hashOAuthState,
  newOAuthState,
  parseTokenKey,
  resolveTokenKeyring,
} from '@/server/social/crypto';

const HEX_KEY = '0123456789abcdef'.repeat(4);
const B64_KEY = Buffer.from(HEX_KEY, 'hex').toString('base64');

describe('Social token crypto', () => {
  it('parses hex and base64 keys and rejects anything else', () => {
    expect(parseTokenKey(HEX_KEY)?.key).toHaveLength(32);
    expect(parseTokenKey(B64_KEY)?.key).toHaveLength(32);
    expect(parseTokenKey('short')).toBeNull();
    expect(parseTokenKey('zz'.repeat(32))).toBeNull();
    expect(parseTokenKey('')).toBeNull();
    expect(parseTokenKey(undefined)).toBeNull();
  });

  it('round-trips tokens with randomized ciphertext', () => {
    const keyring = parseTokenKey(HEX_KEY);
    expect(keyring).not.toBeNull();
    if (!keyring) return;

    const first = encryptToken('ACCESS-SECRET', keyring);
    const second = encryptToken('ACCESS-SECRET', keyring);
    expect(first).not.toBe(second);
    expect(first.startsWith('v1.')).toBe(true);
    expect(first).not.toContain('ACCESS-SECRET');
    expect(decryptToken(first, keyring)).toBe('ACCESS-SECRET');
    expect(decryptToken(second, keyring)).toBe('ACCESS-SECRET');
  });

  it('fails closed on tampering, wrong keys and bad versions', () => {
    const keyring = parseTokenKey(HEX_KEY);
    const other = parseTokenKey('ff'.repeat(32));
    expect(keyring && other).toBeTruthy();
    if (!keyring || !other) return;

    const payload = encryptToken('ACCESS-SECRET', keyring);
    const tampered = `${payload.slice(0, -2)}AA`;
    expect(decryptToken(tampered, keyring)).toBeNull();
    expect(decryptToken(payload, other)).toBeNull();
    expect(decryptToken('v9.aaaa.bbbb', keyring)).toBeNull();
    expect(decryptToken('not-a-payload', keyring)).toBeNull();
  });

  it('issues unguessable states and stores only hashes', () => {
    const first = newOAuthState();
    const second = newOAuthState();
    expect(first.state).not.toBe(second.state);
    expect(first.state).toHaveLength(64);
    expect(first.stateHash).toHaveLength(64);
    expect(first.stateHash).not.toContain(first.state.slice(0, 16));
    expect(hashOAuthState(first.state)).toBe(first.stateHash);
  });

  it('requires a key in production but allows ephemeral keys elsewhere', () => {
    const production = resolveTokenKeyring({ rawKey: null, isProduction: true });
    expect(production.ok).toBe(false);

    const dev = resolveTokenKeyring({ rawKey: null, isProduction: false });
    expect(dev.ok).toBe(true);
    if (!dev.ok) return;
    expect(decryptToken(encryptToken('x', dev.keyring), dev.keyring)).toBe('x');

    const explicit = resolveTokenKeyring({ rawKey: HEX_KEY, isProduction: true });
    expect(explicit.ok).toBe(true);
  });
});
