'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { ErrorState } from '@/components/ui/primitives';
import { ArrowRightIcon, ShieldCheckIcon } from '@/components/ui/icons';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const client = createSupabaseBrowserClient();
    if (!client) {
      setError('Supabase Auth is not configured for this environment.');
      return;
    }

    setStatus('submitting');
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }

      router.replace('/manager');
      router.refresh();
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.');
    } finally {
      setStatus('idle');
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-200" htmlFor="email">Email</label>
        <input
          autoComplete="email"
          className="input"
          disabled={status === 'submitting'}
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@nibrexo.com"
          required
          type="email"
          value={email}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-200" htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          className="input"
          disabled={status === 'submitting'}
          id="password"
          minLength={6}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>
      {error ? <ErrorState message={error} /> : null}
      <button className="btn-primary w-full" disabled={status === 'submitting'} type="submit">
        <ShieldCheckIcon size={16} />
        {status === 'submitting' ? 'Signing in…' : 'Sign in securely'}
        {status === 'submitting' ? null : <ArrowRightIcon size={15} />}
      </button>
    </form>
  );
}
