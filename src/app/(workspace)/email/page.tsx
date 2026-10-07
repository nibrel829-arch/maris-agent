import Link from 'next/link';
import { Badge, Card, EmptyState, KeyValue } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon, InboxIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv, serverEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { checkPermission } from '@/server/auth/permissions';
import { listTemplates, listEmailLogs } from '@/server/email/service';
import { EmailComposer } from '@/features/email/EmailComposer';
import { TemplateStatusBadge } from '@/features/email/TemplateStatusBadge';

export const dynamic = 'force-dynamic';

export default async function EmailWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  }
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;

  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view the Email workspace." />;
  }

  const params = await searchParams;
  const initialTemplateId = params.template ?? undefined;

  const env = serverEnv();
  const providerConfigured = env.emailConfigured;
  const providerName = env.emailProvider ?? 'not configured';
  const canCreate = checkPermission(actor, { module: 'email', action: 'create' }).allowed;
  const canSend = checkPermission(actor, { module: 'email', action: 'send' }).allowed;

  const [templatesResult, logsResult] = await Promise.all([
    listTemplates(actor, repo, { limit: 50, offset: 0 }),
    listEmailLogs(actor, repo, { limit: 20, offset: 0 }),
  ]);

  const templates = templatesResult.ok ? templatesResult.data.templates : [];
  const logs = logsResult.ok ? logsResult.data.logs : [];
  const activeTemplates = templates.filter((t) => (t.status ?? (t.archived ? 'archived' : 'active')) === 'active');

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        title="Email"
        description="Templates, composer, and delivery history — tenant-scoped and permission-gated. Draft/archived templates are never accidentally selected for sending."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href="/email/templates">
              Browse templates <ArrowRightIcon size={15} />
            </Link>
            <Link className="btn-secondary" href="/emails">
              Legacy view
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-6">
          <Card
            title="Provider"
            action={<Badge tone={providerConfigured ? 'success' : 'warning'}>{providerConfigured ? providerName : 'not configured'}</Badge>}
          >
            <KeyValue
              label="Delivery"
              value={
                providerConfigured
                  ? `Production delivery is enabled via ${providerName} (POST https://api.resend.com/emails, Idempotency-Key header, 10 req/s limit).`
                  : 'Emails can be prepared and previewed but not delivered. Set NIBREXO_EMAIL_PROVIDER=resend, RESEND_API_KEY and NIBREXO_EMAIL_FROM to enable sending.'
              }
            />
            <KeyValue label="Sender" value={env.emailFrom ?? 'NIBREXO_EMAIL_FROM is not set'} />
            <KeyValue label="Sending permission" value={canSend ? 'Your role can send (email:send).' : 'Your role cannot send — sending requires email:send (owner/admin).'} />
            {!providerConfigured ? (
              <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
                Provider-not-configured state: the composer can still preview, but send will return 503 not_configured without duplicating.
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn-ghost text-xs" href="/email/templates">
                Manage templates
              </Link>
              <a className="btn-ghost text-xs" href="https://resend.com/docs/api-reference/emails/send-email" target="_blank" rel="noreferrer">
                Resend docs
              </a>
            </div>
          </Card>

          {canSend ? (
            <Card title="Compose & send">
              <EmailComposer templates={templates} initialTemplateId={initialTemplateId} />
            </Card>
          ) : (
            <Card title="Compose & send">
              <EmptyState
                title="Sending not permitted"
                description="Your role (member/client) can prepare drafts and preview templates. Sending requires the email:send permission — ask an owner or admin to send."
              />
              <div className="mt-4">
                <div className="rounded-xl border border-surface-border bg-surface/40 p-3">
                  <p className="text-xs font-medium text-slate-300">Preview-only composer</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">Switch to an owner/admin session to enable delivery, or ask the Manager to prepare a draft for approval.</p>
                </div>
              </div>
            </Card>
          )}

          <Card
            title={`Recent sends (${logs.length})`}
            action={logs.length > 0 ? <Badge tone="info">{logs.length} recorded</Badge> : null}
          >
            {logs.length === 0 ? (
              <EmptyState
                title="No email activity"
                description="Prepared and sent emails are recorded here with status, provider id and error where applicable."
                icon={<InboxIcon size={19} />}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="table-header">
                    <tr>
                      <th className="px-2 py-3">Recipient</th>
                      <th className="px-2 py-3">Subject</th>
                      <th className="px-2 py-3">Status</th>
                      <th className="px-2 py-3">Provider id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="table-row">
                        <td className="px-2 py-3 text-slate-300">{log.to_email}</td>
                        <td className="px-2 py-3 text-slate-400">{log.subject.slice(0, 60)}</td>
                        <td className="px-2 py-3">
                          <Badge tone={log.status === 'SENT' ? 'success' : log.status === 'FAILED' ? 'danger' : 'neutral'}>{log.status}</Badge>
                        </td>
                        <td className="px-2 py-3 font-mono text-xs text-slate-500">{log.provider_message_id ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Link className="btn-ghost text-xs" href="/email/templates">
                View templates
              </Link>
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title={`Templates (${templates.length})`} action={<Link className="btn-ghost text-xs" href="/email/templates">Manage</Link>}>
            {templates.length === 0 ? (
              <EmptyState
                title="No templates"
                description="Create the first reusable template — subject/body with {{variables}} — then preview and send."
                icon={<DocumentIcon size={19} />}
                action={canCreate ? <Link className="btn-primary text-xs" href="/email/templates">Create template</Link> : undefined}
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {templates.slice(0, 8).map((template) => (
                  <li key={template.id} className="rounded-xl border border-surface-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link className="font-medium text-slate-100 hover:underline" href={`/email/templates/${template.id}`}>
                        {template.name}
                      </Link>
                      <TemplateStatusBadge status={template.status ?? (template.archived ? 'archived' : 'active')} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{template.category} · {template.subject.slice(0, 80)}</p>
                    {template.variables.length > 0 ? (
                      <p className="mt-2 font-mono text-[11px] leading-4 text-slate-500">{template.variables.map((v) => `{{${v}}}`).join(' ')}</p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <Link className="btn-ghost px-2 py-1 text-[11px]" href={`/email/templates/${template.id}`}>
                        View
                      </Link>
                      {activeTemplates.some((t) => t.id === template.id) && (
                        <Link className="btn-secondary px-2 py-1 text-[11px]" href={`/email?template=${template.id}`}>
                          Use to send
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Search & filters">
            <p className="text-xs leading-5 text-slate-400">
              Templates are organization-owned and searchable by name, subject, body and category. Filter by draft/active/archived in the templates directory.
            </p>
            <div className="mt-3">
              <Link className="btn-secondary w-full justify-center" href="/email/templates">
                Open directory
              </Link>
            </div>
          </Card>

          <Card title="Idempotency">
            <p className="text-xs leading-5 text-slate-400">
              Every send carries an <span className="font-mono text-slate-300">Idempotency-Key</span> (256 chars, 24h Resend window + local unique index). Retrying with the same key never duplicates — the existing delivery record is returned and the provider is not called twice.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
