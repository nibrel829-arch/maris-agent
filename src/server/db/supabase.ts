/**
 * Supabase client factories (PDF #12 §4, PDF #11 §6).
 *
 * - Browser client uses the anon key only. It can never read privileged data
 *   because RLS is the boundary.
 * - Server client is bound to the caller's session cookies, so RLS applies.
 * - Admin client uses the service role key and is reserved for server-side job
 *   execution. It is never constructed in a request that can be influenced by
 *   a browser.
 */

import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import { publicEnv, serverEnv } from '@/lib/env';

export type NibrexoSupabaseClient = SupabaseClient;

export function createSupabaseBrowserClient(): NibrexoSupabaseClient | null {
  const env = publicEnv();
  if (!env.supabaseConfigured) return null;
  return createBrowserClient(env.supabaseUrl as string, env.supabaseAnonKey as string);
}

export async function createSupabaseServerClient(): Promise<NibrexoSupabaseClient | null> {
  const env = publicEnv();
  if (!env.supabaseConfigured) return null;

  const cookieStore = await cookies();

  return createSsrServerClient(env.supabaseUrl as string, env.supabaseAnonKey as string, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render; middleware refreshes the session instead.
        }
      },
    },
  });
}

export function createSupabaseAdminClient(): NibrexoSupabaseClient | null {
  const env = serverEnv();
  if (!env.supabaseConfigured) return null;
  const key = env.supabaseServiceRoleKey;
  if (!key) return null;
  return createClient(env.supabaseUrl as string, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
