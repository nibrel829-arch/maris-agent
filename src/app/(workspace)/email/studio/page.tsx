import Link from 'next/link';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { ArrowRightIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getBrandProfile, listDesigns } from '@/server/email/design-service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { StudioWorkspace } from '@/features/email/studio/StudioWorkspace';

export const dynamic = 'force-dynamic';

/**
 * Email studio home — saved visual designs and starter templates.
 */
export default async function EmailStudioPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  }
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;

  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view the email studio." />;
  }

  const [designsResult, brandResult] = await Promise.all([
    listDesigns(actor, repo, { limit: 60, offset: 0 }),
    getBrandProfile(actor, repo),
  ]);

  const designs = designsResult.ok ? designsResult.data.designs : [];
  const brand = brandResult.ok ? brandResult.data.profile : null;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Drag-and-drop visual email design with real email rendering, brand system, mobile preview, validation and test sends. Designs are organization-scoped drafts until they are promoted into reusable email templates."
        title="Email studio"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href="/email/brand">
              Brand settings <ArrowRightIcon size={15} />
            </Link>
            <Link className="btn-secondary" href="/email">
              Email workspace <ArrowRightIcon size={15} />
            </Link>
          </div>
        }
      />

      {brand === null ? (
        <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
          No brand profile is saved yet. New blocks fall back to the default Nibrexo tokens — configure the organization
          logo, colours, typography, button style and header/footer defaults in Brand settings.
        </div>
      ) : null}

      {!designsResult.ok ? (
        <p className="text-xs leading-5 text-red-200">{designsResult.error.message}</p>
      ) : null}

      {brand ? (
        <StudioWorkspace
          brandProfile={brand}
          canCreate={checkPermission(actor, { module: 'email', action: 'create' }).allowed}
          canDelete={checkPermission(actor, { module: 'email', action: 'delete' }).allowed}
          canManageBrand={actor.role === 'owner' || actor.role === 'admin'}
          designs={designs}
        />
      ) : null}
    </div>
  );
}
