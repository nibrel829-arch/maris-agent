import Link from 'next/link';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, LightbulbIcon, TargetIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs leading-5 text-slate-500">{empty}</p>;
  return <div className="flex flex-wrap gap-1.5">{items.slice(0, 5).map((item) => <Badge key={item}>{item}</Badge>)}</div>;
}

export default async function ProductPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const concepts = await repoResult.data.productConcepts.list(actorResult.data.organizationId, { limit: 50 });

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Move from an opportunity to a product concept with the customer problem, scope, differentiation and unanswered questions visible in one place."
        title="Product workspace"
        actions={<Link className="btn-primary" href="/manager?request=Build%20a%20product%20concept">Develop a concept <ArrowRightIcon size={15} /></Link>}
      />

      <Card title="Product concepts" action={concepts.length > 0 ? <Badge tone="info">{concepts.length} saved</Badge> : null}>
        {concepts.length === 0 ? (
          <EmptyState
            action={<Link className="btn-primary" href="/manager?request=Build%20a%20product%20concept">Ask the Manager to shape an idea <ArrowRightIcon size={15} /></Link>}
            description="No product concepts have been saved yet. Start with a customer problem or opportunity; Nibrexo will keep assumptions and open questions visible."
            icon={<LightbulbIcon size={19} />}
            title="No product concepts yet"
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {concepts.map((concept) => (
              <article className="rounded-xl border border-surface-border bg-surface/40 p-5" key={concept.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">{concept.name}</h2>
                    <p className="mt-1 text-sm text-slate-400">For {concept.target_customer}</p>
                  </div>
                  <time className="text-[11px] text-slate-500" dateTime={concept.created_at}>{new Date(concept.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                </div>

                <section className="mt-4 border-l border-brand-300/25 pl-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-300">Problem to solve</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">{concept.problem}</p>
                </section>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Differentiation</p>
                    <div className="mt-2"><Chips empty="No differentiation notes saved." items={concept.differentiation} /></div>
                  </section>
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Scope</p>
                    <div className="mt-2"><Chips empty="No scope saved." items={concept.scope} /></div>
                  </section>
                </div>

                {concept.missing_opportunity ? (
                  <section className="mt-4 rounded-lg border border-surface-border/75 bg-[#0a1323]/55 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Opportunity gap</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{concept.missing_opportunity}</p>
                  </section>
                ) : null}

                {concept.open_questions.length > 0 ? (
                  <section className="mt-4">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200"><TargetIcon size={13} /> Open questions</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100/85">
                      {concept.open_questions.slice(0, 3).map((question) => <li key={question}>• {question}</li>)}
                    </ul>
                  </section>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
