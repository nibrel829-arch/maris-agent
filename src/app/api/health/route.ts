import { NextResponse } from 'next/server';
import { publicEnv, serverEnv } from '@/lib/env';
import { listAdapters } from '@/server/integrations/social/adapter';
import { createEmailProvider } from '@/server/integrations/email/provider';

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
      dataBackend: env.dataBackend,
      ai: env.aiEnabled,
      aiModel: env.aiEnabled ? env.aiModel : null,
      emailProvider: createEmailProvider().name,
      emailConfigured: createEmailProvider().isConfigured(),
    },
    integrations: listAdapters(),
    timestamp: new Date().toISOString(),
  });
}
