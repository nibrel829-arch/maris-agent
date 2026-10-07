/**
 * Social account connection service (Phase 7).
 *
 * Flow:
 *   CONNECT -> AUTHORIZE (provider) -> CALLBACK -> EXCHANGE -> IDENTITY
 *         -> UPSERT account + encrypted credentials -> AUDIT
 * Facebook inserts one step: CALLBACK -> PAGE SELECTION -> UPSERT.
 *
 * Tenancy: every read/write is organization-scoped through the repository,
 * and OAuth states bind the organization that initiated the flow — a callback
 * can only complete inside that same organization, even if the actor belongs
 * to several. RLS (0004/0005/0008) enforces the same boundary in Postgres.
 *
 * Secrets: provider tokens are decrypted only inside the call that needs
 * them and are never returned, logged or embedded in errors. List/detail
 * views carry credential *metadata* (scopes, expiry) but no token material.
 */

import { serverEnv } from '@/lib/env';
import { ok, type ServiceResult } from '@/lib/result';
import { checkPermission } from '@/server/auth/permissions';
import type { NibrexoRepository } from '@/server/db/types';
import { writeAudit } from '@/server/manager/audit';
import type {
  ActorContext,
  SocialAccount,
  SocialCapabilities,
  SocialCredential,
  SocialOAuthState,
  SocialPlatform,
  UUID,
} from '@/types/domain';
import type { ManagerIssue } from '@/types/manager';
import {
  decryptToken,
  encryptToken,
  hashOAuthState,
  newOAuthState,
  resolveTokenKeyring,
  TOKEN_KEY_VERSION,
  type TokenKeyring,
} from './crypto';
import {
  defaultProviderHttp,
  getOAuthProvider,
  getProviderCredentials,
  isProviderConfigured,
  ProviderError,
  usablePages,
  CONNECTION_SUPPORT,
  type ConnectablePlatform,
  type FacebookPageCandidate,
  type OAuthProvider,
  type ProviderHttp,
  type ProviderTokenSet,
} from './providers';
import type { CallbackQuery } from './validation';

export interface SocialDeps {
  keyring?: TokenKeyring;
  http?: ProviderHttp;
}

/** Publishing capabilities are Phase 8's; connections store the honest all-false map. */
const UNVERIFIED_PUBLISHING: SocialCapabilities = {
  publish: false,
  schedule: false,
  readDm: false,
  sendDm: false,
  readComments: false,
  replyComments: false,
  analytics: false,
};

const STATE_TTL_MS = 10 * 60 * 1000;

const failIssue = (error: ManagerIssue): ServiceResult<never> => ({ ok: false, error });

function issue(
  code: string,
  message: string,
  errorClass: ManagerIssue['errorClass'],
  retryable = false,
): ManagerIssue {
  return { code, message, severity: 'error', retryable, errorClass };
}

const denied = (actor: ActorContext, action: 'create' | 'edit' | 'delete' | 'view'): ManagerIssue =>
  issue(
    'SOCIAL_PERMISSION_DENIED',
    checkPermission(actor, { module: 'social', action }).reason,
    'permission',
  );

/**
 * Builds the provider redirect URI. `NIBREXO_APP_URL` wins when set (it must
 * match what is registered in each provider dashboard); otherwise the request
 * origin is used, which keeps local development working with no config.
 */
export function buildRedirectUri(platform: SocialPlatform, origin: string): string {
  const base = (serverEnv().appUrl ?? origin).trim().replace(/\/+$/, '');
  const url = new URL(`${base}/api/workspace/social/callback/${platform}`);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Redirect origin must be http(s).');
  }
  return url.toString();
}

/** Browser-safe account view: credential metadata, never token material. */
export interface SocialAccountView {
  id: UUID;
  platform: SocialPlatform;
  external_account_id: string;
  name: string;
  status: SocialAccount['status'];
  capabilities: SocialCapabilities;
  connected_by: UUID | null;
  last_error: string | null;
  scopes: string[];
  expires_at: string | null;
  has_refresh_token: boolean;
  last_refreshed_at: string | null;
  refresh_supported: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderStatusView {
  platform: SocialPlatform;
  label: string;
  connectable: boolean;
  configured: boolean;
  refresh: 'supported' | 'conditional' | 'unsupported' | null;
  note: string;
  docsUrl: string;
}

function toView(account: SocialAccount, credential: SocialCredential | null): SocialAccountView {
  const provider = getOAuthProvider(account.platform);
  return {
    id: account.id,
    platform: account.platform,
    external_account_id: account.external_account_id,
    name: account.name,
    status: account.status,
    capabilities: account.capabilities,
    connected_by: account.connected_by,
    last_error: account.last_error,
    scopes: credential?.scopes ?? [],
    expires_at: credential?.expires_at ?? null,
    has_refresh_token: Boolean(credential?.refresh_token_encrypted),
    last_refreshed_at: credential?.last_refreshed_at ?? null,
    refresh_supported: provider?.supportsRefresh ?? false,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

export function providerStatuses(): ProviderStatusView[] {
  const order: SocialPlatform[] = [
    'tiktok',
    'youtube',
    'pinterest',
    'linkedin',
    'instagram',
    'facebook',
    'contra',
  ];
  return order.map((platform) => {
    const provider = getOAuthProvider(platform);
    const support = CONNECTION_SUPPORT[platform];
    return {
      platform,
      label: provider?.label ?? 'Contra',
      connectable: support.connectable,
      configured: provider ? isProviderConfigured(platform as ConnectablePlatform) : false,
      refresh: support.refresh,
      note: support.note,
      docsUrl: support.docsUrl,
    };
  });
}

function resolveDeps(deps: SocialDeps = {}): { keyring: TokenKeyring; http: ProviderHttp } | { error: ManagerIssue } {
  const http = deps.http ?? defaultProviderHttp();
  if (deps.keyring) return { keyring: deps.keyring, http };
  const keyring = resolveTokenKeyring();
  if (!keyring.ok) return { error: keyring.error };
  return { keyring: keyring.keyring, http };
}

function expiresAt(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return new Date(Date.now() + Math.max(0, seconds) * 1000).toISOString();
}

async function findState(
  repo: NibrexoRepository,
  organizationId: UUID,
  stateToken: string,
): Promise<SocialOAuthState | null> {
  const hash = hashOAuthState(stateToken);
  const states = await repo.socialOauthStates.list(organizationId, { limit: 100 });
  return states.find((row) => row.state_hash === hash) ?? null;
}

function stateUsable(row: SocialOAuthState, platform: SocialPlatform): boolean {
  if (row.platform !== platform) return false;
  if (row.used_at) return false;
  return Date.parse(row.expires_at) > Date.now();
}

async function markStateUsed(
  repo: NibrexoRepository,
  row: SocialOAuthState,
  clearPayload: boolean,
): Promise<void> {
  await repo.socialOauthStates.update(row.id, row.organization_id, {
    used_at: new Date().toISOString(),
    ...(clearPayload ? { payload: null } : {}),
  });
}

/** Best-effort pruning of expired states; failures never fail the caller. */
async function pruneExpiredStates(repo: NibrexoRepository, organizationId: UUID): Promise<void> {
  try {
    const states = await repo.socialOauthStates.list(organizationId, { limit: 100 });
    const now = Date.now();
    for (const row of states) {
      if (Date.parse(row.expires_at) <= now) {
        await repo.socialOauthStates.delete(row.id, organizationId);
      }
    }
  } catch {
    // Pruning is hygiene, not correctness.
  }
}

async function findCredential(
  repo: NibrexoRepository,
  organizationId: UUID,
  accountId: UUID,
): Promise<SocialCredential | null> {
  const rows = await repo.socialCredentials.list(organizationId, { limit: 100 });
  return rows.find((row) => row.account_id === accountId) ?? null;
}

function mapProviderError(error: unknown, platform: string): ManagerIssue {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case 'INVALID_GRANT':
      case 'REFRESH_NOT_GRANTED':
        return issue('SOCIAL_REAUTH_REQUIRED', error.message, 'validation');
      case 'RATE_LIMITED':
        return issue('SOCIAL_RATE_LIMITED', error.message, 'rate_limit', true);
      default:
        return issue(
          'SOCIAL_PROVIDER_ERROR',
          error.message,
          error.retryable ? 'network' : 'server',
          error.retryable,
        );
    }
  }
  const detail = error instanceof Error ? error.message : 'unknown error';
  return issue(
    'SOCIAL_PROVIDER_UNREACHABLE',
    `${platform}: provider request failed (${detail.slice(0, 160)}).`,
    'network',
    true,
  );
}

/* -------------------------------------------------------------------------- */
/* Connect                                                                     */
/* -------------------------------------------------------------------------- */

export async function initiateConnect(
  actor: ActorContext,
  repo: NibrexoRepository,
  platform: SocialPlatform,
  opts: { origin: string },
  deps: SocialDeps = {},
): Promise<ServiceResult<{ authorizeUrl: string }>> {
  if (!checkPermission(actor, { module: 'social', action: 'create' }).allowed) {
    return failIssue(denied(actor, 'create'));
  }

  const provider = getOAuthProvider(platform);
  if (!provider) {
    return failIssue(
      issue(
        'SOCIAL_UNSUPPORTED',
        `${CONNECTION_SUPPORT[platform]?.note ?? 'This platform is not supported.'}`,
        'unsupported',
      ),
    );
  }
  const credentials = getProviderCredentials(platform as ConnectablePlatform);
  if (!credentials) {
    return failIssue(
      issue(
        'SOCIAL_NOT_CONFIGURED',
        `${provider.label} OAuth credentials are not configured on the server.`,
        'not_configured',
      ),
    );
  }
  const resolved = resolveDeps(deps);
  if ('error' in resolved) return failIssue(resolved.error);

  let redirectUri: string;
  try {
    redirectUri = buildRedirectUri(platform, opts.origin);
  } catch {
    return failIssue(issue('SOCIAL_ORIGIN_INVALID', 'Cannot build a valid OAuth redirect URI.', 'validation'));
  }

  await pruneExpiredStates(repo, actor.organizationId);

  const { state, stateHash } = newOAuthState();
  await repo.socialOauthStates.insert({
    organization_id: actor.organizationId,
    platform,
    state_hash: stateHash,
    redirect_uri: redirectUri,
    requested_by: actor.userId,
    payload: null,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    used_at: null,
  });

  return ok({
    authorizeUrl: provider.authorizationUrl({ clientId: credentials.clientId, redirectUri, state }),
  });
}

/* -------------------------------------------------------------------------- */
/* Callback                                                                    */
/* -------------------------------------------------------------------------- */

export type CallbackResult =
  | { status: 'connected'; accountId: UUID }
  | {
      status: 'needs_selection';
      stateToken: string;
      userName: string;
      pages: Array<{ id: string; name: string; tasks: string[] }>;
    };

interface FacebookSelectPayload {
  kind: 'facebook-select';
  userName: string;
  pages: Array<{ id: string; name: string; tasks: string[]; tokenEnc: string }>;
}

function isFacebookSelectPayload(value: unknown): value is FacebookSelectPayload {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === 'facebook-select' &&
    typeof record.userName === 'string' &&
    Array.isArray(record.pages) &&
    record.pages.every(
      (page) =>
        page &&
        typeof page === 'object' &&
        typeof (page as Record<string, unknown>).id === 'string' &&
        typeof (page as Record<string, unknown>).tokenEnc === 'string',
    )
  );
}

function providerDenied(query: CallbackQuery): { userDenied: boolean; message: string } {
  const error = (query.error ?? '').toLowerCase();
  const reason = (query.error_reason ?? '').toLowerCase();
  const userDenied =
    error === 'access_denied' || reason === 'user_denied' || error.startsWith('user_cancelled');
  if (userDenied) {
    return { userDenied: true, message: 'Connection cancelled — the provider authorization was declined.' };
  }
  const detail = (query.error_description ?? query.error ?? 'unknown error').slice(0, 200);
  return { userDenied: false, message: `Provider refused the authorization (${detail}).` };
}

async function upsertAccount(
  repo: NibrexoRepository,
  actor: ActorContext,
  platform: SocialPlatform,
  identity: { externalId: string; displayName: string },
): Promise<SocialAccount> {
  const existing = (await repo.socialAccounts.list(actor.organizationId, { limit: 100 })).find(
    (row) => row.platform === platform && row.external_account_id === identity.externalId,
  );
  if (existing) {
    const updated = await repo.socialAccounts.update(existing.id, actor.organizationId, {
      name: identity.displayName,
      status: 'connected',
      capabilities: { ...UNVERIFIED_PUBLISHING },
      connected_by: actor.userId,
      last_error: null,
    });
    if (!updated) throw new Error('Social account update failed.');
    return updated;
  }
  return repo.socialAccounts.insert({
    organization_id: actor.organizationId,
    platform,
    external_account_id: identity.externalId,
    name: identity.displayName,
    status: 'connected',
    capabilities: { ...UNVERIFIED_PUBLISHING },
    connected_by: actor.userId,
    last_error: null,
  });
}

async function upsertCredential(
  repo: NibrexoRepository,
  actor: ActorContext,
  account: SocialAccount,
  keyring: TokenKeyring,
  provider: OAuthProvider,
  tokens: ProviderTokenSet,
): Promise<void> {
  const existing = await findCredential(repo, actor.organizationId, account.id);
  const accessTokenEncrypted = encryptToken(tokens.accessToken, keyring);
  const refreshTokenEncrypted = tokens.refreshToken
    ? encryptToken(tokens.refreshToken, keyring)
    : (existing?.refresh_token_encrypted ?? null);
  // Expiry values only move when the provider reports them; a missing value
  // keeps the stored one (LinkedIn refresh TTL is fixed at grant time, Google
  // omits refresh data on refresh).
  const expiresAtValue = expiresAt(tokens.expiresIn) ?? existing?.expires_at ?? null;
  const refreshExpiresAtValue =
    expiresAt(tokens.refreshExpiresIn) ?? existing?.refresh_expires_at ?? null;
  const row = {
    credential_ref: TOKEN_KEY_VERSION,
    scopes: tokens.grantedScopes.length > 0 ? tokens.grantedScopes : [...provider.scopes],
    expires_at: expiresAtValue,
    access_token_encrypted: accessTokenEncrypted,
    refresh_token_encrypted: refreshTokenEncrypted,
    token_type: 'bearer',
    refresh_expires_at: refreshExpiresAtValue,
    last_refreshed_at: new Date().toISOString(),
  };
  if (existing) {
    await repo.socialCredentials.update(existing.id, actor.organizationId, row);
  } else {
    await repo.socialCredentials.insert({
      organization_id: actor.organizationId,
      account_id: account.id,
      ...row,
    });
  }
}

export async function completeCallback(
  actor: ActorContext,
  repo: NibrexoRepository,
  platform: SocialPlatform,
  query: CallbackQuery,
  deps: SocialDeps = {},
): Promise<ServiceResult<CallbackResult>> {
  if (!checkPermission(actor, { module: 'social', action: 'create' }).allowed) {
    return failIssue(denied(actor, 'create'));
  }

  const provider: OAuthProvider | null = getOAuthProvider(platform);
  if (!provider) {
    return failIssue(issue('SOCIAL_UNSUPPORTED', 'This platform does not support account connections.', 'unsupported'));
  }

  const row = query.state ? await findState(repo, actor.organizationId, query.state) : null;
  if (!row || !stateUsable(row, platform)) {
    // One message for missing/foreign/used/expired states: state validity is
    // never oracle-able, and cross-tenant states are simply invisible here.
    return failIssue(
      issue('SOCIAL_STATE_INVALID', 'This authorization is invalid or has expired. Start over to reconnect.', 'validation'),
    );
  }

  if (query.error) {
    const { userDenied, message } = providerDenied(query);
    await markStateUsed(repo, row, true);
    return failIssue(issue(userDenied ? 'SOCIAL_USER_DENIED' : 'SOCIAL_PROVIDER_DENIED', message, 'validation'));
  }
  if (!query.code) {
    await markStateUsed(repo, row, true);
    return failIssue(issue('SOCIAL_STATE_INVALID', 'The provider returned no authorization code.', 'validation'));
  }

  const credentials = getProviderCredentials(platform as ConnectablePlatform);
  if (!credentials) {
    return failIssue(
      issue('SOCIAL_NOT_CONFIGURED', `${provider.label} OAuth credentials are not configured on the server.`, 'not_configured'),
    );
  }
  const resolved = resolveDeps(deps);
  if ('error' in resolved) return failIssue(resolved.error);
  const { keyring, http } = resolved;

  let tokens: ProviderTokenSet;
  try {
    tokens = await provider.exchangeCode({
      code: query.code,
      redirectUri: row.redirect_uri,
      credentials,
      http,
    });
  } catch (error) {
    // Grant errors burn the state (retrying cannot help); network errors leave
    // it usable until expiry so a blip costs a retry, not a full restart.
    if (error instanceof ProviderError && !error.retryable) {
      await markStateUsed(repo, row, true);
    }
    return failIssue(mapProviderError(error, provider.label));
  }

  // Facebook connects a Page, not the user: collect candidates.
  if (platform === 'facebook') {
    const candidates = usablePages(tokens.extra);
    if (candidates.length === 0) {
      await markStateUsed(repo, row, true);
      return failIssue(
        issue(
          'SOCIAL_FACEBOOK_NO_PAGE',
          'No Facebook Pages grant this app content permission. Publish rights need a Page role with CREATE_CONTENT.',
          'validation',
        ),
      );
    }
    if (candidates.length === 1) {
      const page = candidates[0] as FacebookPageCandidate;
      const account = await upsertAccount(repo, actor, platform, {
        externalId: page.id,
        displayName: page.name,
      });
      await upsertCredential(repo, actor, account, keyring, provider, {
        ...tokens,
        accessToken: page.accessToken,
        refreshToken: null,
        expiresIn: null,
        refreshExpiresIn: null,
      });
      await markStateUsed(repo, row, true);
      await writeAudit(repo, actor, {
        action: 'social.account.connected',
        entityType: 'social_account',
        entityId: account.id,
        metadata: { platform },
      });
      return ok({ status: 'connected', accountId: account.id });
    }
    const extra = tokens.extra as { userName?: string } | undefined;
    const payload: FacebookSelectPayload = {
      kind: 'facebook-select',
      userName: extra?.userName ?? 'Facebook user',
      pages: candidates.map((page) => ({
        id: page.id,
        name: page.name,
        tasks: page.tasks,
        tokenEnc: encryptToken(page.accessToken, keyring),
      })),
    };
    await repo.socialOauthStates.update(row.id, row.organization_id, {
      payload: payload as unknown as Record<string, unknown>,
    });
    return ok({
      status: 'needs_selection',
      stateToken: query.state as string,
      userName: payload.userName,
      pages: payload.pages.map(({ id, name, tasks }) => ({ id, name, tasks })),
    });
  }

  let identity: { externalId: string; displayName: string };
  try {
    identity = await provider.fetchIdentity({ accessToken: tokens.accessToken, tokenSet: tokens, http });
  } catch (error) {
    await markStateUsed(repo, row, true);
    return failIssue(mapProviderError(error, provider.label));
  }

  const account = await upsertAccount(repo, actor, platform, identity);
  await upsertCredential(repo, actor, account, keyring, provider, tokens);
  await markStateUsed(repo, row, true);
  await writeAudit(repo, actor, {
    action: 'social.account.connected',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform },
  });
  return ok({ status: 'connected', accountId: account.id });
}

/* -------------------------------------------------------------------------- */
/* Facebook Page selection                                                     */
/* -------------------------------------------------------------------------- */

export async function getSelectionState(
  actor: ActorContext,
  repo: NibrexoRepository,
  stateToken: string,
): Promise<{ userName: string; pages: Array<{ id: string; name: string; tasks: string[] }> } | null> {
  if (!checkPermission(actor, { module: 'social', action: 'create' }).allowed) return null;
  const row = await findState(repo, actor.organizationId, stateToken);
  if (!row || !stateUsable(row, 'facebook')) return null;
  if (!isFacebookSelectPayload(row.payload)) return null;
  return {
    userName: row.payload.userName,
    pages: row.payload.pages.map(({ id, name, tasks }) => ({ id, name, tasks })),
  };
}

export async function selectFacebookPage(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: { state: string; page_id: string },
  deps: SocialDeps = {},
): Promise<ServiceResult<{ accountId: UUID }>> {
  if (!checkPermission(actor, { module: 'social', action: 'create' }).allowed) {
    return failIssue(denied(actor, 'create'));
  }
  const provider = getOAuthProvider('facebook');
  if (!provider) return failIssue(issue('SOCIAL_UNSUPPORTED', 'Facebook connections are not supported.', 'unsupported'));

  const row = await findState(repo, actor.organizationId, input.state);
  if (!row || !stateUsable(row, 'facebook') || !isFacebookSelectPayload(row.payload)) {
    return failIssue(
      issue('SOCIAL_STATE_INVALID', 'This Page selection is invalid or has expired. Start over to reconnect.', 'validation'),
    );
  }
  const page = row.payload.pages.find((candidate) => candidate.id === input.page_id);
  if (!page || !page.tasks.includes('CREATE_CONTENT')) {
    return failIssue(issue('SOCIAL_FACEBOOK_PAGE_INVALID', 'Choose one of the listed Pages.', 'validation'));
  }

  const resolved = resolveDeps(deps);
  if ('error' in resolved) return failIssue(resolved.error);
  const pageToken = decryptToken(page.tokenEnc, resolved.keyring);
  if (!pageToken) {
    await markStateUsed(repo, row, true);
    return failIssue(issue('SOCIAL_STATE_INVALID', 'This Page selection is invalid or has expired. Start over to reconnect.', 'validation'));
  }

  const account = await upsertAccount(repo, actor, 'facebook', {
    externalId: page.id,
    displayName: page.name,
  });
  await upsertCredential(repo, actor, account, resolved.keyring, provider, {
    accessToken: pageToken,
    refreshToken: null,
    expiresIn: null,
    refreshExpiresIn: null,
    grantedScopes: [...provider.scopes],
    providerUserId: page.id,
  });
  await markStateUsed(repo, row, true);
  await writeAudit(repo, actor, {
    action: 'social.account.connected',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform: 'facebook' },
  });
  return ok({ accountId: account.id });
}

/* -------------------------------------------------------------------------- */
/* Refresh / disconnect / list                                                 */
/* -------------------------------------------------------------------------- */

export async function refreshAccount(
  actor: ActorContext,
  repo: NibrexoRepository,
  accountId: UUID,
  deps: SocialDeps = {},
): Promise<ServiceResult<SocialAccountView>> {
  if (!checkPermission(actor, { module: 'social', action: 'edit' }).allowed) {
    return failIssue(denied(actor, 'edit'));
  }

  const account = await repo.socialAccounts.get(accountId, actor.organizationId);
  if (!account) {
    return failIssue(issue('SOCIAL_NOT_FOUND', 'Unknown account.', 'validation'));
  }
  const provider = getOAuthProvider(account.platform);
  if (!provider) {
    return failIssue(issue('SOCIAL_UNSUPPORTED', 'This platform does not support account connections.', 'unsupported'));
  }
  if (!provider.supportsRefresh) {
    return failIssue(
      issue(
        'SOCIAL_REFRESH_UNSUPPORTED',
        `${provider.label}: tokens cannot be refreshed programmatically; reconnect the account instead.`,
        'unsupported',
      ),
    );
  }

  const stored = await findCredential(repo, actor.organizationId, account.id);
  if (!stored) {
    await repo.socialAccounts.update(account.id, actor.organizationId, {
      status: 'reconnect_required',
      last_error: 'Stored credentials are missing; reconnect the account.',
    });
    return failIssue(issue('SOCIAL_REAUTH_REQUIRED', 'Stored credentials are missing; reconnect the account.', 'validation'));
  }

  const credentials = getProviderCredentials(account.platform as ConnectablePlatform);
  if (!credentials) {
    return failIssue(
      issue('SOCIAL_NOT_CONFIGURED', `${provider.label} OAuth credentials are not configured on the server.`, 'not_configured'),
    );
  }
  const resolved = resolveDeps(deps);
  if ('error' in resolved) return failIssue(resolved.error);
  const { keyring, http } = resolved;

  const accessToken = stored.access_token_encrypted
    ? decryptToken(stored.access_token_encrypted, keyring)
    : null;
  const refreshToken = stored.refresh_token_encrypted
    ? decryptToken(stored.refresh_token_encrypted, keyring)
    : null;
  if (!accessToken && provider.platform === 'instagram') {
    await repo.socialAccounts.update(account.id, actor.organizationId, {
      status: 'reconnect_required',
      last_error: 'Stored credentials cannot be read; reconnect the account.',
    });
    return failIssue(issue('SOCIAL_REAUTH_REQUIRED', 'Stored credentials cannot be read; reconnect the account.', 'validation'));
  }

  let tokens: ProviderTokenSet;
  try {
    tokens = await provider.refreshToken({
      credentials,
      accessToken: accessToken ?? '',
      refreshToken,
      http,
    });
  } catch (error) {
    if (error instanceof ProviderError && (error.code === 'INVALID_GRANT' || error.code === 'REFRESH_NOT_GRANTED')) {
      await repo.socialAccounts.update(account.id, actor.organizationId, {
        status: 'reconnect_required',
        last_error: error.message,
      });
      return failIssue(issue('SOCIAL_REAUTH_REQUIRED', error.message, 'validation'));
    }
    return failIssue(mapProviderError(error, provider.label));
  }

  await upsertCredential(repo, actor, account, keyring, provider, {
    ...tokens,
    // Refresh responses may omit what did not change; upsert keeps the
    // stored values for anything the provider does not report.
    refreshToken: tokens.refreshToken,
  });
  const updated = await repo.socialAccounts.update(account.id, actor.organizationId, {
    status: 'connected',
    last_error: null,
  });
  if (!updated) return failIssue(issue('SOCIAL_NOT_FOUND', 'Unknown account.', 'validation'));

  await writeAudit(repo, actor, {
    action: 'social.account.refreshed',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform: account.platform },
  });
  const credential = await findCredential(repo, actor.organizationId, account.id);
  return ok(toView(updated, credential));
}

export async function disconnectAccount(
  actor: ActorContext,
  repo: NibrexoRepository,
  accountId: UUID,
  deps: SocialDeps = {},
): Promise<ServiceResult<{ disconnected: true }>> {
  if (!checkPermission(actor, { module: 'social', action: 'delete' }).allowed) {
    return failIssue(denied(actor, 'delete'));
  }

  const account = await repo.socialAccounts.get(accountId, actor.organizationId);
  if (!account) {
    return failIssue(issue('SOCIAL_NOT_FOUND', 'Unknown account.', 'validation'));
  }

  const stored = await findCredential(repo, actor.organizationId, account.id);
  const provider = getOAuthProvider(account.platform);

  // Best-effort provider revocation (verified for Google only). A revocation
  // failure never blocks the local wipe: the tokens are deleted regardless.
  if (provider?.revokeToken && stored?.access_token_encrypted) {
    try {
      const resolved = resolveDeps(deps);
      const http = deps.http ?? defaultProviderHttp();
      if (!('error' in resolved)) {
        const accessToken = decryptToken(stored.access_token_encrypted, resolved.keyring);
        if (accessToken) await provider.revokeToken({ token: accessToken, http });
      }
    } catch {
      // Local state is authoritative for a disconnect.
    }
  }

  if (stored) {
    await repo.socialCredentials.delete(stored.id, actor.organizationId);
  }
  await repo.socialAccounts.update(account.id, actor.organizationId, {
    status: 'disconnected',
    last_error: null,
  });
  await writeAudit(repo, actor, {
    action: 'social.account.disconnected',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform: account.platform },
  });
  return ok({ disconnected: true });
}

export async function listAccounts(
  actor: ActorContext,
  repo: NibrexoRepository,
): Promise<ServiceResult<{ accounts: SocialAccountView[]; providers: ProviderStatusView[] }>> {
  if (!checkPermission(actor, { module: 'social', action: 'view' }).allowed) {
    return failIssue(denied(actor, 'view'));
  }
  const [accounts, credentials] = await Promise.all([
    repo.socialAccounts.list(actor.organizationId, { limit: 100 }),
    repo.socialCredentials.list(actor.organizationId, { limit: 100 }),
  ]);
  const byAccount = new Map(credentials.map((row) => [row.account_id, row]));
  return ok({
    accounts: accounts.map((account) => toView(account, byAccount.get(account.id) ?? null)),
    providers: providerStatuses(),
  });
}
