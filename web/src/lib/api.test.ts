import { describe, expect, it } from 'vitest';
import { safeRedirect } from './api';

describe('safeRedirect', () => {
  it.each(['/app', '/app/bookings', '/app?tab=all', '/onboard', '/onboard?step=2'])(
    'allows the internal path %s',
    (path) => {
      expect(safeRedirect(path)).toBe(path);
    },
  );

  it.each([
    null,
    undefined,
    12,
    '/',
    '/application',
    '/onboarded',
    '//example.com',
    'https://example.com',
    '/app\\@example.com',
    '/onboard/../login',
    '/app/%2e%2e/login',
  ])('rejects an unsafe or unsupported path: %s', (path) => {
    expect(safeRedirect(path)).toBeNull();
  });
});
