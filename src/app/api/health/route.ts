import { NextResponse } from 'next/server';
import { publicEnv, serverEnv } from '@/lib/env';
import { listAdapters } from '@/server/integrations/social/adapter';
import { createEmailProvider } from '@/server/integrations/email/provider';
import { appUrlStatus, assetSigningSource } from '@/server/email/asset-url';

export const dynamic = 'force-dynamic';

/**
 * Production smoke-test endpoint (PDF #11 §10, §17).
 * Reports real configuration state — it never reports a healthy integration
 * that is not actually configured.
 */
export async function GET(): Promise<NextResponse> {
  const env = serverEnv();
  const pub = publicEnv();

  return NextResponse.json({
    ok: true,
    service: 'nibrexo-os-ai',
    environment: env.isProduction ? 'production' : 'development',
    configuration: {
      supabase: pub.supabaseConfigured,
      // Names only — no URL or key material is ever returned.
      supabasePublicKeySource: pub.supabasePublicKeySource,
      supabaseServiceKeyConfigured: Boolean(env.supabaseServiceRoleKey),
      supabaseServiceKeySource: env.supabaseServiceKeySource,
      dataBackend: env.dataBackend,
      ai: env.aiEnabled,
      aiModel: env.aiEnabled ? env.aiModel : null,
      emailProvider: createEmailProvider().name,
      emailConfigured: createEmailProvider().isConfigured(),
      // Names and states only: which key signs email asset links, and whether
      // NIBREXO_APP_URL is unset / valid / invalid. Never the values.
      emailAssetSigning: assetSigningSource(),
      appUrl: appUrlStatus(),
    },
    integrations: listAdapters(),
    timestamp: new Date().toISOString(),
  });
}
