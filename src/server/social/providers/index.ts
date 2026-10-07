/**
 * OAuth provider registry (Phase 7).
 *
 * Six of the seven Nibrexo platforms expose a verified user-OAuth flow and
 * have an adapter here; Contra has no public user-OAuth API (read-only
 * Public API key + MCP server only) and is represented as unsupported
 * everywhere instead of faked.
 */

import { serverEnv } from '@/lib/env';
import type { SocialPlatform } from '@/types/domain';
import { isConnectablePlatform, type ConnectablePlatform } from '../validation';
import type { OAuthProvider, ProviderCredentials } from './core';
import { tiktokProvider } from './tiktok';
import { youtubeProvider } from './youtube';
import { pinterestProvider } from './pinterest';
import { linkedinProvider } from './linkedin';
import { instagramProvider } from './instagram';
import { facebookProvider } from './facebook';

export type { ConnectablePlatform } from '../validation';
export type {
  OAuthProvider,
  ProviderCredentials,
  ProviderHttp,
  ProviderHttpCall,
  ProviderHttpInit,
  ProviderHttpResponse,
  ProviderTokenSet,
  ProviderIdentity,
} from './core';
export { ProviderError } from './core';
export { defaultProviderHttp } from './core';
export type { FacebookPageCandidate, FacebookExchangeExtra } from './facebook';
export { usablePages } from './facebook';

const REGISTRY: Record<ConnectablePlatform, OAuthProvider> = {
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
  pinterest: pinterestProvider,
  linkedin: linkedinProvider,
  instagram: instagramProvider,
  facebook: facebookProvider,
};

export function getOAuthProvider(platform: SocialPlatform): OAuthProvider | null {
  if (!isConnectablePlatform(platform)) return null;
  return REGISTRY[platform];
}

/** Reads the per-platform client credentials from server-only env. Null when incomplete. */
export function getProviderCredentials(platform: ConnectablePlatform): ProviderCredentials | null {
  const entry = serverEnv().oauthClients[platform];
  if (!entry?.clientId || !entry?.clientSecret) return null;
  return { clientId: entry.clientId, clientSecret: entry.clientSecret };
}

export function isProviderConfigured(platform: ConnectablePlatform): boolean {
  return getProviderCredentials(platform) !== null;
}

export type RefreshSupport = 'supported' | 'conditional' | 'unsupported';

export interface ConnectionSupport {
  connectable: boolean;
  refresh: RefreshSupport | null;
  /** Short honest note shown in the UI. */
  note: string;
  docsUrl: string;
}

/**
 * Verified connection/refresh posture per platform. Publishing capabilities
 * stay with the Phase 8 adapter layer (`server/integrations/social/adapter`);
 * this table only claims what Phase 7 verified about connecting.
 */
export const CONNECTION_SUPPORT: Record<SocialPlatform, ConnectionSupport> = {
  tiktok: {
    connectable: true,
    refresh: 'supported',
    note: 'Login Kit OAuth. Access tokens last 24 hours; refresh tokens last 1 year and may rotate on refresh.',
    docsUrl: 'https://developers.tiktok.com/',
  },
  youtube: {
    connectable: true,
    refresh: 'supported',
    note: 'Google OAuth with offline access. Refresh tokens are long-lived; disconnect also revokes at Google.',
    docsUrl: 'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps',
  },
  pinterest: {
    connectable: true,
    refresh: 'supported',
    note: 'API v5 OAuth. Access tokens last 30 days; continuous refresh tokens last 60 days and refresh indefinitely.',
    docsUrl: 'https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/',
  },
  linkedin: {
    connectable: true,
    refresh: 'conditional',
    note: 'Access tokens last 60 days. Refresh works only for apps approved for programmatic refresh tokens; otherwise reconnect at expiry.',
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
  },
  instagram: {
    connectable: true,
    refresh: 'supported',
    note: 'Business Login for professional accounts. Long-lived tokens last 60 days and refresh for another 60.',
    docsUrl:
      'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login',
  },
  facebook: {
    connectable: true,
    refresh: 'unsupported',
    note: 'Facebook Login for Pages. Page tokens do not expire; user tokens cannot be refreshed programmatically, so reconnect instead.',
    docsUrl: 'https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow',
  },
  contra: {
    connectable: false,
    refresh: null,
    note: 'Unsupported: Contra offers no public user-OAuth API — only a read-only Public API key and an MCP server.',
    docsUrl: 'https://contra.com/',
  },
};
