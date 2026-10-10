import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { ArrowRightIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getBrandProfile, getDesign } from '@/server/email/design-service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { EmailStudioBuilder } from '@/features/email/studio/EmailStudioBuilder';
import { DEFAULT_EMAIL_BRAND_PROFILE } from '@/types/email-design';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * The visual builder for one design. The page only resolves identity,
 * permissions and the stored document; every interaction (drag-and-drop,
 * styling, undo/redo, autosave, preview, test send) happens in the client
 * builder against the same render pipeline the delivered email uses.
 */
export default async function EmailStudioDesignPage({ params }: PageProps) {
  const { id } = await params;

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

  const [designResult, brandResult] = await Promise.all([
    getDesign(actor, repo, id),
    getBrandProfile(actor, repo),
  ]);

  if (!designResult.ok) {
    if (designResult.error.code === 'DESIGN_NOT_FOUND') notFound();
    return <ConfigurationRequired reason={designResult.error.message} />;
  }

  const design = designResult.data;
  const brand = brandResult.ok ? brandResult.data.profile : DEFAULT_EMAIL_BRAND_PROFILE;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PageHeader
        description={`${design.category} · ${design.status} design · ${design.design.blocks.length} blocks · source ${design.source}`}
        title={design.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href="/email/studio">
              All designs <ArrowRightIcon size={15} />
            </Link>
            <Link className="btn-secondary" href="/email/brand">
              Brand settings
            </Link>
          </div>
        }
      />

      <EmailStudioBuilder
        brandProfile={brand}
        canDelete={checkPermission(actor, { module: 'email', action: 'delete' }).allowed}
        canEdit={checkPermission(actor, { module: 'email', action: 'edit' }).allowed}
        canManageBrand={actor.role === 'owner' || actor.role === 'admin'}
        canSend={checkPermission(actor, { module: 'email', action: 'send' }).allowed}
        design={design}
      />
    </div>
  );
}
