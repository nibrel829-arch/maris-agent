import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card } from '@/components/ui/primitives';
import { ArrowRightIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getTemplate } from '@/server/email/service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { EditTemplateForm } from '@/features/email/EditTemplateForm';
import { TemplateStatusBadge } from '@/features/email/TemplateStatusBadge';

export const dynamic = 'force-dynamic';

export default async function EmailTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;

  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view email templates." />;
  }

  const result = await getTemplate(actor, repo, id);
  if (!result.ok) {
    if (result.error.code === 'TEMPLATE_NOT_FOUND') notFound();
    return <ConfigurationRequired reason={result.error.message} />;
  }

  const template = result.data;
  const status = template.status ?? (template.archived ? 'archived' : 'active');
  const canEdit = checkPermission(actor, { module: 'email', action: 'edit' }).allowed;
  const canSend = checkPermission(actor, { module: 'email', action: 'send' }).allowed;

  return (
    <div className="mx-auto max-w-[980px] space-y-6">
      <PageHeader
        title={template.name}
        description={`${template.category} · ${status} template with ${template.variables.length} variable(s).`}
        actions={<Link className="btn-secondary" href="/email/templates">Back to templates <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_300px]">
        <Card
          title="Template"
          action={
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{template.category}</Badge>
              <TemplateStatusBadge status={status} />
            </div>
          }
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Subject</dt>
              <dd className="mt-1 font-medium text-slate-100">{template.subject}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Body</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-surface-border bg-surface/40 p-3 text-sm leading-6 text-slate-300">{template.body}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Variables</dt>
              <dd className="mt-1 font-mono text-xs text-slate-500">
                {template.variables.length ? template.variables.map((v) => `{{${v}}}`).join(' ') : 'None — literal template'}
              </dd>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link className="btn-secondary" href={`/email?template=${template.id}`} aria-disabled={!canSend || status !== 'active'}>
                {status !== 'active' ? `Cannot send — ${status}` : canSend ? 'Use to compose & send' : 'View only — sending requires email:send'}
              </Link>
              <Link className="btn-ghost" href="/email/templates">
                Back
              </Link>
            </div>
          </dl>
        </Card>

        <div className="space-y-6">
          <Card title={canEdit ? 'Edit template' : 'Template locked'}>
            {canEdit ? <EditTemplateForm template={template} /> : <p className="text-sm leading-6 text-slate-400">Your role cannot edit templates (requires email:edit). View-only mode.</p>}
          </Card>

          <Card title="Audit">
            <p className="text-xs leading-5 text-slate-400">
              Created {new Date(template.created_at).toLocaleString()} · Updated {new Date(template.updated_at).toLocaleString()}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">Template changes are audited as email.template.* events.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
