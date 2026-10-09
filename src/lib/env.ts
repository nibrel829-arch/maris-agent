/**
 * Environment configuration.
 *
 * Secrets are read from the environment only and are never shipped to the
 * browser. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the current Supabase
 * equivalent of the legacy anonymous key and is intentionally safe to expose
 * to browser code; service/secret keys remain server-only.
 */

const isProduction = process.env.NODE_ENV === 'production';

const optional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const flag = (value: string | undefined): boolean => {
  const v = optional(value);
  return v === '1' || v === 'true' || v === 'yes';
};

type PublicKeySource =
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
  | null;

type ServiceKeySource = 'SUPABASE_SERVICE_ROLE_KEY' | 'SUPABASE_SECRET_KEY' | null;

function publicSupabaseKey(): { value: string | null; source: PublicKeySource } {
  const legacyAnon = optional(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (legacyAnon) return { value: legacyAnon, source: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' };

  const publishable = optional(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (publishable) return { value: publishable, source: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' };

  return { value: null, source: null };
}

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function imageProviderFrom(value: string | undefined): 'local' | 'cloudflare' | 'auto' | 'openai' {
  if (value === 'local' || value === 'cloudflare' || value === 'openai') return value;
  return 'auto';
}

function serverSupabaseKey(): { value: string | null; source: ServiceKeySource } {
  const serviceRole = optional(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (serviceRole) return { value: serviceRole, source: 'SUPABASE_SERVICE_ROLE_KEY' };

  const secretKey = optional(process.env.SUPABASE_SECRET_KEY);
  if (secretKey) return { value: secretKey, source: 'SUPABASE_SECRET_KEY' };

  return { value: null, source: null };
}

export type DataBackend = 'supabase' | 'memory';

export interface PublicEnv {
  supabaseUrl: string | null;
  /** Legacy internal name retained so repository interfaces do not change. */
  supabaseAnonKey: string | null;
  /** Safe diagnostic metadata only; never contains key material. */
  supabasePublicKeySource: PublicKeySource;
  supabaseConfigured: boolean;
  isProduction: boolean;
}

export interface ServerEnv extends PublicEnv {
  supabaseServiceRoleKey: string | null;
  /** Safe diagnostic metadata only; never contains key material. */
  supabaseServiceKeySource: ServiceKeySource;
  aiProvider: string;
  aiModel: string;
  openAiApiKey: string | null;
  /** True only when a real AI provider key is present. */
  aiEnabled: boolean;
  dataBackend: DataBackend;
  devAuthEnabled: boolean;
  devOrgId: string;
  /** Server-only AES-256 key (hex/base64) for social token encryption. Null when unset. */
  tokenEncryptionKey: string | null;
  /** Server-only shared secret authorizing the publish sweeper cron endpoint. Null when unset. */
  cronSecret: string | null;
  /** Public app origin used for OAuth redirect URIs. Null falls back to the request origin. */
  appUrl: string | null;
  /** Per-platform OAuth client credentials (server-only; null fields mean unconfigured). */
  oauthClients: Record<string, { clientId: string | null; clientSecret: string | null }>;
  /** Email provider selection (resend). Null means unconfigured — no delivery. */
  emailProvider: string | null;
  /** Verified sender address for outbound email (NIBREXO_EMAIL_FROM). Null when unset. */
  emailFrom: string | null;
  /** Whether Resend credentials are present (truthy only when api key + from are set). */
  emailConfigured: boolean;
  /** Server-only DeepSeek key. Null when unset. Never used unless paid synthesis is explicitly allowed. */
  deepseekApiKey: string | null;
  deepseekModel: string;
  /** True only when the operator opted into paid synthesis and a key is present. */
  deepseekConfigured: boolean;
  allowPaidSynthesis: boolean;
  /** Server-only Brave Search key. A key alone does not authorize a paid search. */
  braveSearchApiKey: string | null;
  webSearchConfigured: boolean;
  allowPaidSearch: boolean;
  /** Kept so older env files still parse. Not used to call an image API. */
  imageProvider: 'local' | 'cloudflare' | 'auto' | 'openai';
  localImageUrl: string | null;
  cloudflareAccountId: string | null;
  cloudflareApiToken: string | null;
  /** Nibrexo image worker. A vendor token is never enough. */
  imageEngineUrl: string | null;
  imageEngineToken: string | null;
  imageWeightsDir: string | null;
  imageGenerationConfigured: boolean;
  imageHourlyLimit: number;
}

export function publicEnv(): PublicEnv {
  const url = optional(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = publicSupabaseKey();
  return {
    supabaseUrl: url ?? null,
    supabaseAnonKey: key.value,
    supabasePublicKeySource: key.source,
    supabaseConfigured: Boolean(url && key.value),
    isProduction,
  };
}

export function serverEnv(): ServerEnv {
  const pub = publicEnv();
  const openAiApiKey = optional(process.env.OPENAI_API_KEY) ?? null;
  const serviceKey = serverSupabaseKey();

  // The in-memory backend exists for local development and tests only.
  // It must never be selected in production — that would silently discard data.
  const configuredBackend = optional(process.env.NIBREXO_DATA_BACKEND) ?? 'supabase';
  const dataBackend: DataBackend =
    configuredBackend === 'memory' && !isProduction ? 'memory' : 'supabase';

  const emailProvider = optional(process.env.NIBREXO_EMAIL_PROVIDER)?.toLowerCase() ?? null;
  const emailFrom = optional(process.env.NIBREXO_EMAIL_FROM) ?? null;
  const resendKey = optional(process.env.RESEND_API_KEY) ?? null;
  const emailConfigured = emailProvider === 'resend' && Boolean(resendKey && emailFrom);
  const deepseekApiKey = optional(process.env.DEEPSEEK_API_KEY) ?? null;
  const braveSearchApiKey = optional(process.env.BRAVE_SEARCH_API_KEY) ?? null;
  const allowPaidSynthesis = flag(process.env.NIBREXO_ALLOW_PAID_SYNTHESIS);
  const allowPaidSearch = flag(process.env.NIBREXO_ALLOW_PAID_SEARCH);
  const imageProvider = imageProviderFrom(optional(process.env.NIBREXO_IMAGE_PROVIDER));
  const localImageUrl = httpUrl(optional(process.env.NIBREXO_LOCAL_IMAGE_URL));
  const cloudflareAccountId = optional(process.env.CLOUDFLARE_ACCOUNT_ID) ?? null;
  const cloudflareApiToken = optional(process.env.CLOUDFLARE_API_TOKEN) ?? null;
  const imageEngineUrl = httpUrl(optional(process.env.NIBREXO_IMAGE_ENGINE_URL)) ?? localImageUrl;
  const imageEngineToken = optional(process.env.NIBREXO_IMAGE_ENGINE_TOKEN) ?? null;
  const imageWeightsDir = optional(process.env.NIBREXO_IMAGE_WEIGHTS_DIR) ?? null;
  const hourly = Number(optional(process.env.NIBREXO_IMAGE_HOURLY_LIMIT) ?? '4');

  return {
    ...pub,
    supabaseServiceRoleKey: serviceKey.value,
    supabaseServiceKeySource: serviceKey.source,
    aiProvider: optional(process.env.NIBREXO_AI_PROVIDER) ?? 'openai',
    aiModel: optional(process.env.NIBREXO_AI_MODEL) ?? 'gpt-4o-mini',
    openAiApiKey,
    aiEnabled: Boolean(openAiApiKey),
    dataBackend,
    devAuthEnabled: flag(process.env.NIBREXO_DEV_AUTH) && !isProduction,
    devOrgId:
      optional(process.env.NIBREXO_DEV_ORG_ID) ?? '00000000-0000-0000-0000-000000000001',
    tokenEncryptionKey: optional(process.env.NIBREXO_TOKEN_ENCRYPTION_KEY) ?? null,
    // Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`
    // when that env var is set, so it takes precedence; NIBREXO_CRON_SECRET
    // is the self-hosted alias.
    cronSecret: optional(process.env.CRON_SECRET) ?? optional(process.env.NIBREXO_CRON_SECRET) ?? null,
    appUrl: optional(process.env.NIBREXO_APP_URL) ?? null,
    emailProvider,
    emailFrom,
    emailConfigured,
    deepseekApiKey,
    deepseekModel: optional(process.env.NIBREXO_DEEPSEEK_MODEL) ?? 'deepseek-flash',
    allowPaidSynthesis,
    deepseekConfigured: allowPaidSynthesis && Boolean(deepseekApiKey),
    braveSearchApiKey,
    allowPaidSearch,
    webSearchConfigured: allowPaidSearch && Boolean(braveSearchApiKey),
    imageProvider,
    localImageUrl,
    cloudflareAccountId,
    cloudflareApiToken,
    imageEngineUrl,
    imageEngineToken,
    imageWeightsDir,
    imageGenerationConfigured: Boolean(imageEngineUrl),
    imageHourlyLimit: Number.isFinite(hourly) ? Math.max(1, Math.min(20, Math.round(hourly))) : 4,
    oauthClients: {
      // TikTok names its id `client_key`; the env var mirrors the provider.
      tiktok: {
        clientId: optional(process.env.NIBREXO_TIKTOK_CLIENT_KEY) ?? null,
        clientSecret: optional(process.env.NIBREXO_TIKTOK_CLIENT_SECRET) ?? null,
      },
      youtube: {
        clientId: optional(process.env.NIBREXO_GOOGLE_CLIENT_ID) ?? null,
        clientSecret: optional(process.env.NIBREXO_GOOGLE_CLIENT_SECRET) ?? null,
      },
      pinterest: {
        clientId: optional(process.env.NIBREXO_PINTEREST_CLIENT_ID) ?? null,
        clientSecret: optional(process.env.NIBREXO_PINTEREST_CLIENT_SECRET) ?? null,
      },
      linkedin: {
        clientId: optional(process.env.NIBREXO_LINKEDIN_CLIENT_ID) ?? null,
        clientSecret: optional(process.env.NIBREXO_LINKEDIN_CLIENT_SECRET) ?? null,
      },
      // Instagram Business Login uses the Instagram App ID/Secret (not the Meta app keys).
      instagram: {
        clientId: optional(process.env.NIBREXO_INSTAGRAM_CLIENT_ID) ?? null,
        clientSecret: optional(process.env.NIBREXO_INSTAGRAM_CLIENT_SECRET) ?? null,
      },
      facebook: {
        clientId: optional(process.env.NIBREXO_META_CLIENT_ID) ?? null,
        clientSecret: optional(process.env.NIBREXO_META_CLIENT_SECRET) ?? null,
      },
    },
  };
}
