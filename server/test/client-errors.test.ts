import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('client error reports', () => {
  it('accepts a public report and truncates its logged stack', async () => {
    const store = new Store(':memory:');
    const app = createApp({ store });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const response = await app.request('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Page failed to load.',
        stack: 'x'.repeat(2000),
        url: 'https://serviceready.example/app',
        user_agent: 'Mobile Chrome',
        boundary: 'root'
      })
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[client-error]', expect.any(String));
    const logged = JSON.parse(String(log.mock.calls[0]?.[1])) as Record<string, unknown>;
    expect(logged).toMatchObject({
      message: 'Page failed to load.',
      url: 'https://serviceready.example/app',
      user_agent: 'Mobile Chrome',
      boundary: 'root'
    });
    expect(logged.stack).toHaveLength(1500);
    store.close();
  });

  it('rejects reports with unknown fields', async () => {
    const store = new Store(':memory:');
    const app = createApp({ store });
    const response = await app.request('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Failed.', url: '/app', extra: 'reject me' })
    });

    expect(response.status).toBe(400);
    store.close();
  });
});
