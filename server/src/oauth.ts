import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { z } from 'zod';
import { createSessionToken, hashSessionToken } from './auth.js';
import type { OAuthCodeRecord, OAuthGrantRecord, OAuthRequestPayload, OAuthTokenRecord, Store, UserRecord } from './db.js';
import { createId, timestamp } from './db.js';
import type { Seller } from './types.js';

const scopesSupported = ['studio', 'offline_access'] as const;
const redirectArraySchema = z.array(z.string().min(1).max(2048)).min(1).max(5);
const registrationSchema = z.object({
  redirect_uris: redirectArraySchema,
  client_name: z.string().trim().min(1).max(100).optional(),
  token_endpoint_auth_method: z.unknown().optional(),
  grant_types: z.array(z.string().min(1).max(100)).optional(),
  response_types: z.array(z.string().min(1).max(100)).optional()
}).passthrough();

export interface OAuthSessionContext {
  tokenHash: string;
  user: UserRecord;
  seller: Seller;
}

export interface OAuthClientMetadata {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  [key: string]: unknown;
}

export interface OAuthOptions {
  store: Store;
  baseUrl: string;
  getSessionContext: (context: Context) => OAuthSessionContext | null;
  fetchClientMetadata?: (url: string) => Promise<unknown>;
  rateLimit?: (context: Context, maxRequests: number, windowMs: number) => boolean;
}

export interface SellerOAuthPrincipal {
  grant: OAuthGrantRecord;
  user: UserRecord;
  seller: Seller;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoopback(url: URL): boolean {
  return url.hostname.toLowerCase() === 'localhost' || url.hostname === '127.0.0.1';
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || value.includes('#')) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));
  } catch {
    return false;
  }
}

function redirectMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  try {
    const actual = new URL(requested);
    const expected = new URL(registered);
    return isLoopback(actual) && isLoopback(expected) &&
      actual.protocol === expected.protocol &&
      actual.hostname.toLowerCase() === expected.hostname.toLowerCase() &&
      actual.pathname === expected.pathname &&
      actual.search === expected.search &&
      actual.username === expected.username &&
      actual.password === expected.password &&
      !actual.hash && !expected.hash;
  } catch {
    return false;
  }
}

function validClientMetadata(value: unknown, clientId: string): OAuthClientMetadata | null {
  if (!isRecord(value) || value.client_id !== clientId || !Array.isArray(value.redirect_uris)) return null;
  if (value.redirect_uris.length < 1 || value.redirect_uris.length > 5 ||
      !value.redirect_uris.every((uri) => typeof uri === 'string' && validRedirectUri(uri))) return null;
  if (value.client_name !== undefined &&
      (typeof value.client_name !== 'string' || value.client_name.trim().length < 1 || value.client_name.length > 100)) return null;
  if (value.token_endpoint_auth_method !== undefined && value.token_endpoint_auth_method !== 'none') return null;
  return {
    ...value,
    client_id: clientId,
    client_name: typeof value.client_name === 'string' ? value.client_name : clientId,
    redirect_uris: value.redirect_uris as string[]
  };
}

function safeClientMetadataUrl(clientId: string): URL | null {
  try {
    const url = new URL(clientId);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const ipHostname = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    if (url.protocol !== 'https:' || url.username || url.password || clientId.includes('#')) return null;
    if (isIP(ipHostname) || hostname === 'localhost' || hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') || hostname.endsWith('.internal')) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchMetadataDocument(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error('Client metadata request failed.');
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new Error('Client metadata must be JSON.');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
    throw new Error('Client metadata is too large.');
  }
  if (!response.body) throw new Error('Client metadata response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) {
        await reader.cancel();
        throw new Error('Client metadata is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

function plainAuthorizeError(message: string): Response {
  return new Response(`<!doctype html><html><body><h1>Bad request</h1><p>${message}</p></body></html>`, {
    status: 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function oauthError(error: string, status = 400, description?: string): Response {
  return Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}

function createRedirectUrl(uri: string, params: Record<string, string | undefined>): string {
  const redirect = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) redirect.searchParams.set(key, value);
  }
  return redirect.toString();
}

function tokenResponse(store: Store, grant: OAuthGrantRecord, resource: string): Record<string, unknown> {
  const now = Date.now();
  const createdAt = timestamp();
  const accessToken = createSessionToken();
  const accessExpiresAt = new Date(now + 60 * 60_000).toISOString();
  store.saveOAuthToken({
    token_hash: hashSessionToken(accessToken),
    grant_id: grant.id,
    kind: 'access_token',
    resource,
    expires_at: accessExpiresAt,
    status: 'active',
    created_at: createdAt
  });
  const response: Record<string, unknown> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: grant.scope
  };
  if (grant.scope.split(/\s+/).includes('offline_access')) {
    const refreshToken = createSessionToken();
    store.saveOAuthToken({
      token_hash: hashSessionToken(refreshToken),
      grant_id: grant.id,
      kind: 'refresh_token',
      resource,
      expires_at: new Date(now + 30 * 86_400_000).toISOString(),
      status: 'active',
      created_at: createdAt
    });
    response.refresh_token = refreshToken;
  }
  store.updateOAuthGrantLastUsed(grant.id, createdAt);
  return response;
}

async function readTokenRequest(context: Context): Promise<Record<string, string>> {
  const raw = await context.req.text();
  if (raw.length > 16 * 1024) throw new Error('Request body is too large.');
  const contentType = context.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  if (contentType === 'application/json') {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || Object.values(parsed).some((entry) => typeof entry !== 'string')) {
      throw new Error('Token request must be an object of string values.');
    }
    return parsed as Record<string, string>;
  }
  throw new Error('Token request must use JSON or form encoding.');
}

export function sellerOAuthResource(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp/seller`;
}

export function sellerOAuthChallenge(baseUrl: string, invalidToken = false): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp/seller", scope="studio"${invalidToken ? ', error="invalid_token"' : ''}`;
}

export function authenticateSellerAccessToken(
  store: Store,
  token: string,
  resource: string
): SellerOAuthPrincipal | null {
  if (!token || token.length > 512) return null;
  const tokenRecord = store.getOAuthToken(hashSessionToken(token));
  if (!tokenRecord || tokenRecord.kind !== 'access_token' || tokenRecord.status !== 'active' ||
      Date.parse(tokenRecord.expires_at) <= Date.now() || tokenRecord.resource !== resource) return null;
  const grant = store.getOAuthGrant(tokenRecord.grant_id);
  if (!grant || !grant.scope.split(/\s+/).includes('studio')) return null;
  const user = store.getUserById(grant.user_id);
  const seller = store.getSellerById(grant.seller_id);
  if (!user || user.seller_id !== grant.seller_id || !seller) return null;
  return { grant, user, seller };
}

export function registerOAuthRoutes(app: Hono, options: OAuthOptions): void {
  const { store, getSessionContext } = options;
  const base = options.baseUrl.replace(/\/+$/, '');
  const resource = sellerOAuthResource(base);
  const metadataCache = new Map<string, { expiresAt: number; metadata: OAuthClientMetadata }>();
  const fetchClientMetadata = options.fetchClientMetadata ?? fetchMetadataDocument;

  async function resolveClient(clientId: string): Promise<OAuthClientMetadata | null> {
    if (!clientId || clientId.length > 2048) return null;
    const registered = store.getOAuthClient(clientId);
    if (registered) return validClientMetadata(registered.metadata, clientId);
    if (!clientId.startsWith('https://') || !safeClientMetadataUrl(clientId)) return null;
    const cached = metadataCache.get(clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.metadata;
    metadataCache.delete(clientId);
    try {
      const metadata = validClientMetadata(await fetchClientMetadata(clientId), clientId);
      if (!metadata) return null;
      metadataCache.set(clientId, { metadata, expiresAt: Date.now() + 60 * 60_000 });
      return metadata;
    } catch {
      return null;
    }
  }

  const authServerMetadata = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    scopes_supported: [...scopesSupported]
  };

  app.get('/.well-known/oauth-protected-resource/mcp/seller', (c) => c.json({
    resource,
    authorization_servers: [base],
    scopes_supported: [...scopesSupported],
    bearer_methods_supported: ['header'],
    resource_name: 'ServiceReady studio'
  }));
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(authServerMetadata));
  app.get('/.well-known/*', (c) => c.json({ error: 'Not found.' }, 404));

  app.post('/oauth/register', async (c) => {
    if (options.rateLimit && !options.rateLimit(c, 20, 60 * 60_000)) {
      return oauthError('slow_down', 429, 'Too many client registrations.');
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return oauthError('invalid_client_metadata', 400, 'Registration request must be JSON.');
    }
    const parsed = registrationSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.redirect_uris.every(validRedirectUri)) {
      return oauthError('invalid_client_metadata', 400, 'Client metadata is invalid.');
    }
    const clientId = createId('oc');
    const metadata = {
      ...parsed.data,
      client_id: clientId,
      client_name: parsed.data.client_name ?? 'OAuth client',
      token_endpoint_auth_method: 'none'
    };
    store.saveOAuthClient(clientId, metadata, timestamp());
    return c.json({ ...metadata, client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
  });

  app.get('/oauth/authorize', async (c) => {
    const query = new URL(c.req.url).searchParams;
    const clientId = query.get('client_id') ?? '';
    const client = await resolveClient(clientId);
    if (!client) return plainAuthorizeError('Invalid OAuth client.');
    const redirectUri = query.get('redirect_uri') ?? '';
    if (!redirectUri || !client.redirect_uris.some((registered) => redirectMatches(redirectUri, registered))) {
      return plainAuthorizeError('Invalid redirect URI.');
    }
    const state = query.get('state') ?? undefined;
    const responseType = query.get('response_type');
    if (responseType !== 'code') {
      return c.redirect(createRedirectUrl(redirectUri, { error: 'unsupported_response_type', state }), 302);
    }
    const codeChallenge = query.get('code_challenge') ?? '';
    const codeChallengeMethod = query.get('code_challenge_method');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge) || codeChallengeMethod !== 'S256') {
      return c.redirect(createRedirectUrl(redirectUri, { error: 'invalid_request', state }), 302);
    }
    const requestedResource = query.get('resource');
    if (requestedResource && requestedResource !== resource) {
      return c.redirect(createRedirectUrl(redirectUri, { error: 'invalid_target', state }), 302);
    }
    const requestedScope = query.has('scope') ? (query.get('scope') ?? '') : 'studio';
    const scopes = [...new Set(requestedScope.trim().split(/\s+/).filter(Boolean))];
    if (!scopes.length || scopes.some((scope) => !scopesSupported.includes(scope as typeof scopesSupported[number])) ||
        !scopes.includes('studio')) {
      return c.redirect(createRedirectUrl(redirectUri, { error: 'invalid_scope', state }), 302);
    }
    const requestId = createId('oar');
    const payload: OAuthRequestPayload = {
      client_id: clientId,
      client_name: client.client_name,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      ...(state === undefined ? {} : { state }),
      scope: scopes.join(' '),
      resource
    };
    store.saveOAuthRequest({
      id: requestId,
      payload,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    return c.redirect(`${base}/authorize?request=${encodeURIComponent(requestId)}`, 302);
  });

  app.get('/api/oauth/requests/:id', (c) => {
    const session = getSessionContext(c);
    if (!session) return c.json({ error: 'Please log in.' }, 401);
    const request = store.getOAuthRequest(c.req.param('id'));
    if (!request || Date.parse(request.expires_at) <= Date.now()) {
      if (request) store.deleteOAuthRequest(request.id);
      return c.json({ error: 'Authorization request not found.' }, 404);
    }
    let redirectHost = '';
    try {
      redirectHost = new URL(request.payload.redirect_uri).host;
    } catch {
      return c.json({ error: 'Authorization request not found.' }, 404);
    }
    return c.json({
      client_name: request.payload.client_name,
      redirect_host: redirectHost,
      studio_name: session.seller.name,
      scopes: request.payload.scope.split(/\s+/)
    });
  });

  app.post('/api/oauth/requests/:id/decision', async (c) => {
    const origin = c.req.header('origin');
    const fetchSite = c.req.header('sec-fetch-site');
    if ((origin && origin !== new URL(base).origin) || fetchSite === 'cross-site') {
      return c.json({ error: 'Cross-site authorization decisions are not allowed.' }, 403);
    }
    const session = getSessionContext(c);
    if (!session) return c.json({ error: 'Please log in.' }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Request body must be JSON.' }, 400);
    }
    const parsedBody = z.object({ allow: z.boolean() }).strict().safeParse(body);
    if (!parsedBody.success) return c.json({ error: 'Expected { allow: boolean }.' }, 400);
    const request = store.getOAuthRequest(c.req.param('id'));
    if (!request || Date.parse(request.expires_at) <= Date.now()) {
      if (request) store.deleteOAuthRequest(request.id);
      return c.json({ error: 'Authorization request not found.' }, 404);
    }
    store.deleteOAuthRequest(request.id);
    if (!parsedBody.data.allow) {
      return c.json({
        redirect_url: createRedirectUrl(request.payload.redirect_uri, {
          error: 'access_denied',
          state: request.payload.state,
          iss: base
        })
      });
    }
    const code = createSessionToken();
    const codeRecord: OAuthCodeRecord = {
      code_hash: hashSessionToken(code),
      user_id: session.user.id,
      seller_id: session.seller.id,
      client_id: request.payload.client_id,
      client_name: request.payload.client_name,
      redirect_uri: request.payload.redirect_uri,
      code_challenge: request.payload.code_challenge,
      scope: request.payload.scope,
      resource: request.payload.resource,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      created_at: timestamp()
    };
    store.saveOAuthCode(codeRecord);
    return c.json({
      redirect_url: createRedirectUrl(request.payload.redirect_uri, {
        code,
        state: request.payload.state,
        iss: base
      })
    });
  });

  app.post('/oauth/token', async (c) => {
    if (options.rateLimit && !options.rateLimit(c, 60, 60_000)) {
      return oauthError('slow_down', 429, 'Too many token requests.');
    }
    let params: Record<string, string>;
    try {
      params = await readTokenRequest(c);
    } catch (error) {
      return oauthError('invalid_request', 400, error instanceof Error ? error.message : undefined);
    }
    const grantType = params.grant_type;
    if (!params.client_id) return oauthError('invalid_client', 401);
    if (grantType === 'authorization_code') {
      if (!params.code || !params.redirect_uri || !params.code_verifier) return oauthError('invalid_request');
      const codeHash = hashSessionToken(params.code);
      const code = store.getOAuthCode(codeHash);
      if (!code || code.client_id !== params.client_id || code.redirect_uri !== params.redirect_uri ||
          Date.parse(code.expires_at) <= Date.now() ||
          (params.resource !== undefined && params.resource !== code.resource) ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_verifier)) {
        return oauthError('invalid_grant');
      }
      const challenge = createHash('sha256').update(params.code_verifier).digest('base64url');
      if (challenge !== code.code_challenge) return oauthError('invalid_grant');
      const user = store.getUserById(code.user_id);
      const seller = store.getSellerById(code.seller_id);
      if (!user || user.seller_id !== code.seller_id || !seller) {
        store.deleteOAuthCode(codeHash);
        return oauthError('invalid_grant');
      }
      store.deleteOAuthCode(codeHash);
      const existing = store.getOAuthGrantForClient(code.user_id, code.client_id);
      const grant = store.saveOAuthGrant({
        id: existing?.id ?? createId('ogr'),
        user_id: code.user_id,
        seller_id: code.seller_id,
        client_id: code.client_id,
        client_name: code.client_name,
        scope: code.scope,
        created_at: existing?.created_at ?? timestamp(),
        last_used_at: existing?.last_used_at ?? null
      });
      return c.json(tokenResponse(store, grant, code.resource), 200, { 'cache-control': 'no-store' });
    }
    if (grantType === 'refresh_token') {
      if (!params.refresh_token) return oauthError('invalid_request');
      const token = store.getOAuthToken(hashSessionToken(params.refresh_token));
      if (!token || token.kind !== 'refresh_token') return oauthError('invalid_grant');
      const grant = store.getOAuthGrant(token.grant_id);
      if (!grant || grant.client_id !== params.client_id) return oauthError('invalid_grant');
      if (token.status === 'rotated') {
        store.deleteOAuthGrant(grant.id);
        return oauthError('invalid_grant');
      }
      if (token.status !== 'active' || Date.parse(token.expires_at) <= Date.now() ||
          (params.resource !== undefined && params.resource !== token.resource)) return oauthError('invalid_grant');
      const user = store.getUserById(grant.user_id);
      const seller = store.getSellerById(grant.seller_id);
      if (!user || user.seller_id !== grant.seller_id || !seller) {
        store.deleteOAuthGrant(grant.id);
        return oauthError('invalid_grant');
      }
      store.setOAuthTokenStatus(token.token_hash, 'rotated');
      return c.json(tokenResponse(store, grant, token.resource), 200, { 'cache-control': 'no-store' });
    }
    return oauthError('unsupported_grant_type');
  });

  app.post('/oauth/revoke', async (c) => {
    try {
      const params = await readTokenRequest(c);
      if (params.token) {
        const token = store.getOAuthToken(hashSessionToken(params.token));
        if (token) {
          if (token.kind === 'refresh_token') store.deleteOAuthGrant(token.grant_id);
          else store.setOAuthTokenStatus(token.token_hash, 'revoked');
        }
      }
    } catch {
    }
    return c.body(null, 200, { 'cache-control': 'no-store' });
  });

  app.get('/api/oauth/grants', (c) => {
    const session = getSessionContext(c);
    if (!session) return c.json({ error: 'Please log in.' }, 401);
    return c.json(store.listOAuthGrants(session.user.id).map(({ id, client_name, created_at, last_used_at }) => ({
      id,
      client_name,
      created_at,
      last_used_at
    })));
  });

  app.delete('/api/oauth/grants/:id', (c) => {
    const session = getSessionContext(c);
    if (!session) return c.json({ error: 'Please log in.' }, 401);
    if (!store.deleteOAuthGrant(c.req.param('id'), session.user.id)) {
      return c.json({ error: 'Connected assistant not found.' }, 404);
    }
    return c.body(null, 204);
  });
}
