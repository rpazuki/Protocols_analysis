import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginRequest } from '../../apps/web/src/server/same-origin.ts';
import { exportRequestSchema } from '@protocols/domain';

/**
 * The export endpoint releases raw email addresses and the full text of every
 * matching report. It is POST-only and same-origin checked, so producing one
 * is always a deliberate submit from the export page rather than something a
 * link, a prefetch, an image tag, or a form on another site can trigger.
 */

const OPTIONS = { appUrl: 'https://protocols.lab.example.ac.uk' };

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('security: export same-origin requirement', () => {
  test('accepts a submit from our own page', () => {
    assert.equal(
      isSameOriginRequest(
        headers({
          origin: 'https://protocols.lab.example.ac.uk',
          host: 'protocols.lab.example.ac.uk',
        }),
        OPTIONS,
      ),
      true,
    );
  });

  test('rejects a form posted from another site', () => {
    assert.equal(
      isSameOriginRequest(
        headers({ origin: 'https://evil.example.com', host: 'protocols.lab.example.ac.uk' }),
        OPTIONS,
      ),
      false,
    );
  });

  test('rejects a request with no Origin header', () => {
    // A browser always sends Origin on a POST, so a missing one means a
    // non-browser client, which must not be able to opt out of the check.
    assert.equal(isSameOriginRequest(headers({ host: 'protocols.lab.example.ac.uk' }), OPTIONS), false);
  });

  test('rejects an opaque "null" Origin, as sent by a sandboxed iframe', () => {
    assert.equal(isSameOriginRequest(headers({ origin: 'null', host: 'x' }), OPTIONS), false);
  });

  test('rejects an unparsable Origin', () => {
    assert.equal(isSameOriginRequest(headers({ origin: 'not a url', host: 'x' }), OPTIONS), false);
    assert.equal(isSameOriginRequest(headers({ origin: '', host: 'x' }), OPTIONS), false);
  });

  test('rejects a look-alike host', () => {
    assert.equal(
      isSameOriginRequest(
        headers({
          origin: 'https://protocols.lab.example.ac.uk.evil.com',
          host: 'protocols.lab.example.ac.uk',
        }),
        OPTIONS,
      ),
      false,
    );
  });

  test('works behind a proxy that rewrites Host, without trusting any header', () => {
    // The browser still sends the public origin, which is what APP_URL names.
    assert.equal(
      isSameOriginRequest(
        headers({ origin: 'https://protocols.lab.example.ac.uk', host: 'localhost:3000' }),
        OPTIONS,
      ),
      true,
    );
  });

  test('a spoofed X-Forwarded-Host cannot make a foreign origin pass', () => {
    // The header is attacker-controllable unless the proxy overwrites it, and
    // the app cannot verify that from here, so it is not consulted at all.
    assert.equal(
      isSameOriginRequest(
        headers({
          origin: 'https://evil.example.com',
          host: 'localhost:3000',
          'x-forwarded-host': 'evil.example.com',
        }),
        OPTIONS,
      ),
      false,
    );
  });

  test('a spoofed X-Forwarded-Host cannot vouch for itself against APP_URL', () => {
    assert.equal(
      isSameOriginRequest(
        headers({
          origin: 'https://evil.example.com',
          'x-forwarded-host': 'protocols.lab.example.ac.uk',
          'x-forwarded-proto': 'https',
        }),
        OPTIONS,
      ),
      false,
    );
  });

  test('a plaintext origin does not match the secure production host', () => {
    // Comparing hosts alone would let http://host match an https deployment.
    assert.equal(
      isSameOriginRequest(
        headers({ origin: 'http://protocols.lab.example.ac.uk', host: 'protocols.lab.example.ac.uk' }),
        OPTIONS,
      ),
      false,
    );
  });

  test('a different port is a different origin', () => {
    assert.equal(
      isSameOriginRequest(headers({ origin: 'http://localhost:4000', host: 'localhost:3000' }), {
        appUrl: 'http://localhost:3000',
      }),
      false,
    );
  });

  test('ALLOWED_ORIGINS entries are accepted, with or without a scheme', () => {
    const withExtra = {
      appUrl: 'https://protocols.lab.example.ac.uk',
      allowedOrigins: ['https://alias.lab.example.ac.uk', 'bare.lab.example.ac.uk'],
    };
    assert.equal(
      isSameOriginRequest(headers({ origin: 'https://alias.lab.example.ac.uk' }), withExtra),
      true,
    );
    // A bare host inherits APP_URL's scheme, so it stays https here.
    assert.equal(
      isSameOriginRequest(headers({ origin: 'https://bare.lab.example.ac.uk' }), withExtra),
      true,
    );
    assert.equal(
      isSameOriginRequest(headers({ origin: 'http://bare.lab.example.ac.uk' }), withExtra),
      false,
    );
    assert.equal(
      isSameOriginRequest(headers({ origin: 'https://other.example.com' }), withExtra),
      false,
    );
  });

  test('a malformed APP_URL fails closed rather than accepting everything', () => {
    assert.equal(
      isSameOriginRequest(headers({ origin: 'https://anything.example.com' }), { appUrl: 'not a url' }),
      false,
    );
  });
});

describe('security: export request validation', () => {
  test('recycled records stay excluded unless explicitly requested', () => {
    assert.equal(exportRequestSchema.parse({}).includeRecycled, false);
    assert.equal(exportRequestSchema.parse({ includeRecycled: true }).includeRecycled, true);
  });

  test('an unknown format is refused rather than defaulted', () => {
    assert.throws(() => exportRequestSchema.parse({ format: 'xlsx' }));
  });

  test('a malformed date filter is refused', () => {
    assert.throws(() => exportRequestSchema.parse({ from: '2026-02-30' }));
  });
});
