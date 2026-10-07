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
  /** Public app origin used for OAuth redirect URIs. Null falls back to the request origin. */
  appUrl: string | null;
  /** Per-platform OAuth client credentials (server-only; null fields mean unconfigured). */
  oauthClients: Record<string, { clientId: string | null; clientSecret: string | null }>;
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
    appUrl: optional(process.env.NIBREXO_APP_URL) ?? null,
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
