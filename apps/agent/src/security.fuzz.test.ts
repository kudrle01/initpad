import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { normalizeControlPlaneUrl } from './config.js';

// Property-based fuzzing of the control-plane URL the Agent sends its
// credential to: whatever the input, the result is an HTTPS URL (or loopback
// HTTP) without credentials, query or fragment, or the input is rejected.
test('normalizeControlPlaneUrl only returns credential-safe URLs', () => {
  const input = fc.oneof(
    fc.string(),
    fc.webUrl({ withQueryParameters: true, withFragments: true }),
    fc
      .tuple(fc.constantFrom('http', 'https', 'ftp', 'javascript', 'file'), fc.webAuthority())
      .map(([scheme, authority]) => `${scheme}://${authority}`),
    fc.constantFrom('https://user:pass@example.com', 'http://127.0.0.1:3000/', 'https://x.test///'),
  );
  fc.assert(
    fc.property(input, (raw) => {
      let normalized: string;
      try {
        normalized = normalizeControlPlaneUrl(raw);
      } catch (error) {
        assert.ok(error instanceof Error);
        return;
      }
      const url = new URL(normalized);
      const loopback =
        url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname.startsWith('127.');
      assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && loopback), normalized);
      assert.equal(url.username, '');
      assert.equal(url.password, '');
      assert.equal(url.search, '');
      assert.equal(url.hash, '');
      assert.ok(!normalized.endsWith('/'), normalized);
    }),
    { numRuns: 2000 },
  );
});
