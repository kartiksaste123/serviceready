import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';

describe('static response cache headers', () => {
  let directory: string | null = null;
  const originalWebDist = process.env.WEB_DIST;

  afterEach(() => {
    if (originalWebDist === undefined) delete process.env.WEB_DIST;
    else process.env.WEB_DIST = originalWebDist;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  it('caches assets immutably and revalidates the app shell', async () => {
    directory = mkdtempSync(join(tmpdir(), 'serviceready-static-'));
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'index.html'), '<html></html>');
    writeFileSync(join(directory, 'assets', 'x.js'), 'console.log("ready");');
    process.env.WEB_DIST = directory;
    const store = new Store(':memory:');
    const app = createApp({ store });

    const asset = await app.request('/assets/x.js');
    const index = await app.request('/');

    expect(asset.status).toBe(200);
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(index.status).toBe(200);
    expect(index.headers.get('Cache-Control')).toBe('no-cache');
    store.close();
  });
});
