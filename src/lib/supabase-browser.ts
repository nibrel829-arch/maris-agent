'use client';

/**
 * Browser-only Supabase factory. Both values must be public variables so Next
 * can include them in the browser bundle. Modern Supabase projects provide a
 * publishable key; older projects may still provide an anonymous key.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) return null;
  return createBrowserClient(url, publicKey);
}
