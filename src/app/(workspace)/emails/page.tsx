import { Badge, Card, EmptyState, KeyValue } from '@/components/ui/primitives';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { createEmailProvider } from '@/server/integrations/email/provider';

export const dynamic = 'force-dynamic';

export default async function EmailPage() {
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

  const [templates, logs, sequences] = await Promise.all([
    repo.emailTemplates.list(actor.organizationId, { limit: 100 }),
    repo.emailLogs.list(actor.organizationId, { limit: 100 }),
    repo.emailSequences.list(actor.organizationId, { limit: 50 }),
  ]);

  const provider = createEmailProvider();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Email</h1>
        <p className="mt-1 text-sm text-slate-400">
          Templates, prepared emails, sequences and delivery logs.
        </p>
      </div>

      <Card
        title="Provider"
        action={
          <Badge tone={provider.isConfigured() ? 'success' : 'warning'}>
            {provider.isConfigured() ? provider.name : 'not configured'}
          </Badge>
        }
      >
        <KeyValue
          label="Delivery"
          value={
            provider.isConfigured()
              ? 'Production delivery is enabled through the provider adapter.'
              : 'Emails can be prepared and approved but not delivered. Set NIBREXO_EMAIL_PROVIDER and provider credentials to enable sending.'
          }
        />
        <KeyValue label="Sending approval" value="Always required before an external send." />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Templates (${templates.length})`}>
          {templates.length === 0 ? (
            <EmptyState
              title="No templates"
              description="Ask the Manager to draft an email template."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {templates.map((template) => (
                <li key={template.id} className="rounded-lg border border-surface-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-100">{template.name}</span>
                    <Badge>{template.category}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{template.subject}</p>
                  {template.variables.length > 0 ? (
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      {template.variables.map((v) => `{{${v}}}`).join(' ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Email log (${logs.length})`}>
          {logs.length === 0 ? (
            <EmptyState
              title="No email activity"
              description="Prepared and sent emails are recorded here."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {logs.map((log) => (
                <li key={log.id} className="rounded-lg border border-surface-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-100">{log.to_email}</span>
                    <Badge tone={log.status === 'SENT' ? 'success' : 'neutral'}>{log.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{log.subject}</p>
                  {log.error_message ? (
                    <p className="mt-1 text-xs text-amber-300">{log.error_message}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Sequences (${sequences.length})`}>
        {sequences.length === 0 ? (
          <EmptyState
            title="No sequences"
            description="Ask the Manager to create a follow-up sequence with delays and stop conditions."
          />
        ) : (
          <ul className="space-y-2 text-sm">
            {sequences.map((sequence) => (
              <li key={sequence.id} className="rounded-lg border border-surface-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-100">{sequence.name}</span>
                  <Badge>{sequence.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-400">Trigger: {sequence.trigger}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
