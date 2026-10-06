'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    const client = createSupabaseBrowserClient();
    if (!client) return;
    setBusy(true);
    try {
      await client.auth.signOut();
      router.replace('/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn-secondary min-h-9 rounded-lg px-3 text-xs" disabled={busy} onClick={() => void signOut()} type="button">
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
