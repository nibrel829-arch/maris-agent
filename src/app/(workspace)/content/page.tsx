import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : (
      <ConfigurationRequired reason={actorResult.error.message} />
    );
  }
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;

  const [items, concepts, campaigns] = await Promise.all([
    repo.contentItems.list(actor.organizationId, { limit: 100 }),
    repo.visualConcepts.list(actor.organizationId, { limit: 50 }),
    repo.campaignPlans.list(actor.organizationId, { limit: 50 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Content</h1>
        <p className="mt-1 text-sm text-slate-400">
          Media, drafts, visual concepts and campaign plans. Drafts never auto-publish.
        </p>
      </div>

      <Card title={`Content items (${items.length})`}>
        {items.length === 0 ? (
          <EmptyState
            title="No content yet"
            description="Ask the Manager to draft content, or upload media once storage is configured."
          />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-surface-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-100">{item.title}</span>
                  <div className="flex gap-2">
                    {item.platforms.map((platform) => (
                      <Badge key={platform}>{platform}</Badge>
                    ))}
                    <Badge tone={item.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                      {item.status}
                    </Badge>
                  </div>
                </div>
                {item.caption ? (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.caption}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Visual concepts (${concepts.length})`}>
          {concepts.length === 0 ? (
            <EmptyState title="No visual concepts" description="Ask the Manager for a visual concept." />
          ) : (
            <ul className="space-y-2 text-sm">
              {concepts.map((concept) => (
                <li key={concept.id} className="rounded-lg border border-surface-border p-3">
                  <p className="text-slate-100">{concept.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{concept.purpose}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Campaign plans (${campaigns.length})`}>
          {campaigns.length === 0 ? (
            <EmptyState title="No campaigns" description="Ask the Manager to plan a campaign." />
          ) : (
            <ul className="space-y-2 text-sm">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="rounded-lg border border-surface-border p-3">
                  <p className="text-slate-100">{campaign.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{campaign.objective}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {campaign.channels.map((channel) => (
                      <Badge key={channel}>{channel}</Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
