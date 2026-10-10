import Link from 'next/link';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { ArrowRightIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getBrandProfile } from '@/server/email/design-service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { BrandSettingsForm } from '@/features/email/BrandSettingsForm';
import { DEFAULT_EMAIL_BRAND_PROFILE } from '@/types/email-design';

export const dynamic = 'force-dynamic';

/**
 * Organization brand + design system (Phase 16 §4).
 *
 * Logo and brand assets, colours, typography, button styles, header/footer
 * defaults. Reusable sections are saved from the studio and listed here.
 */
export default async function EmailBrandPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  }
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;

  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view email brand settings." />;
  }

  const brandResult = await getBrandProfile(actor, repo);
  if (!brandResult.ok) return <ConfigurationRequired reason={brandResult.error.message} />;

  const { profile, recordId } = brandResult.data;
  const canManage = checkPermission(actor, { module: 'email', action: 'edit' }).allowed && (actor.role === 'owner' || actor.role === 'admin');

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Organization-wide email brand: logo and assets, colours, typography, button style, header and footer defaults. These values seed every new block and can be applied to an existing design from the studio."
        title="Email brand"
        actions={
          <Link className="btn-secondary" href="/email/studio">
            Back to studio <ArrowRightIcon size={15} />
          </Link>
        }
      />

      {profile.savedSections.length > 0 ? (
        <section className="panel space-y-3 p-5">
          <h2 className="card-title">Reusable sections ({profile.savedSections.length})</h2>
          <p className="text-xs leading-5 text-slate-400">
            Saved blocks that can be dropped into any design from the studio block library.
          </p>
          <ul className="space-y-2">
            {profile.savedSections.map((section) => (
              <li className="panel-subtle flex items-center justify-between gap-3 p-3" key={section.id}>
                <div>
                  <p className="text-sm font-medium text-slate-100">{section.name}</p>
                  <p className="text-[11px] text-slate-500">{section.block.type} block</p>
                </div>
                <span className="font-mono text-[10px] text-slate-600">{section.id.slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="panel space-y-2 p-5">
          <h2 className="card-title">Reusable sections</h2>
          <p className="text-xs leading-5 text-slate-400">
            No reusable sections yet. In the studio, select a block and use “Save as reusable section” to make it
            available to every design in this organization.
          </p>
        </section>
      )}

      <BrandSettingsForm canManage={canManage} profile={profile} recordId={recordId ?? null} />

      {!brandResult.data.profile ? null : null}
      <p className="text-[11px] leading-4 text-slate-600">
        Defaults are used until a design overrides them: {DEFAULT_EMAIL_BRAND_PROFILE.brandName}.
      </p>
    </div>
  );
}
