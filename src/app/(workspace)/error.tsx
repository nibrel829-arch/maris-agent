'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ArrowRightIcon } from '@/components/ui/icons';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The UI remains intentionally non-specific; server logs receive the error.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center">
      <section className="card w-full text-center">
        <p className="page-eyebrow">Nibrexo CEO Operating Cockpit</p>
        <h1 className="mt-2 text-xl font-semibold text-white">This workspace could not load</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
          No work was changed. Try loading the workspace again, or return to the Manager if the issue continues.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button className="btn-primary" onClick={reset} type="button">Try again</button>
          <Link className="btn-secondary" href="/manager">Open Manager <ArrowRightIcon size={15} /></Link>
        </div>
      </section>
    </div>
  );
}
