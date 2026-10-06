/**
 * Environment configuration.
 *
 * Secrets are read from the environment only and are never shipped to the
 * browser (PDF #11 §6, PDF #12 §17). Server-only values are accessed through
 * `serverEnv()`, which throws if called from client code paths that would
 * expose them.
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

export type DataBackend = 'supabase' | 'memory';

export interface PublicEnv {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseConfigured: boolean;
  isProduction: boolean;
}

export interface ServerEnv extends PublicEnv {
  supabaseServiceRoleKey: string | null;
  aiProvider: string;
  aiModel: string;
  openAiApiKey: string | null;
  /** True only when a real AI provider key is present. */
  aiEnabled: boolean;
  dataBackend: DataBackend;
  devAuthEnabled: boolean;
  devOrgId: string;
}

export function publicEnv(): PublicEnv {
  const url = optional(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anon = optional(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return {
    supabaseUrl: url ?? null,
    supabaseAnonKey: anon ?? null,
    supabaseConfigured: Boolean(url && anon),
    isProduction,
  };
}

export function serverEnv(): ServerEnv {
  const pub = publicEnv();
  const openAiApiKey = optional(process.env.OPENAI_API_KEY) ?? null;

  // The in-memory backend exists for local development and tests only.
  // It must never be selected in production — that would silently discard data.
  const configuredBackend = optional(process.env.NIBREXO_DATA_BACKEND) ?? 'supabase';
  const dataBackend: DataBackend =
    configuredBackend === 'memory' && !isProduction ? 'memory' : 'supabase';

  return {
    ...pub,
    supabaseServiceRoleKey: optional(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? null,
    aiProvider: optional(process.env.NIBREXO_AI_PROVIDER) ?? 'openai',
    aiModel: optional(process.env.NIBREXO_AI_MODEL) ?? 'gpt-4o-mini',
    openAiApiKey,
    aiEnabled: Boolean(openAiApiKey),
    dataBackend,
    devAuthEnabled: flag(process.env.NIBREXO_DEV_AUTH) && !isProduction,
    devOrgId:
      optional(process.env.NIBREXO_DEV_ORG_ID) ?? '00000000-0000-0000-0000-000000000001',
  };
}
