import { Badge, Card, KeyValue } from '@/components/ui/primitives';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { SignOutButton } from '@/features/auth/SignOutButton';
import { resolveActor } from '@/server/auth/actor';
import { actionsFor, roleLabel } from '@/server/auth/permissions';
import { publicEnv, serverEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { listAdapters } from '@/server/integrations/social/adapter';
import { listCapabilities } from '@/server/manager/capability-registry';
import { createEmailProvider } from '@/server/integrations/email/provider';
import type { ModuleId } from '@/types/manager';

export const dynamic = 'force-dynamic';

const MODULES: ModuleId[] = [
  'dashboard',
  'social',
  'content',
  'inbox',
  'clients',
  'email',
  'ai',
  'settings',
];

export default async function SettingsPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : (
      <ConfigurationRequired reason={actorResult.error.message} />
    );
  }

  const actor = actorResult.data;
  const env = serverEnv();
  const provider = createEmailProvider();

  return (
    <div className="space-y-6">
      <PageHeader
        description="Runtime configuration and effective permissions. Secret values are never displayed in the workspace."
        title="Settings"
        actions={!actor.isDevIdentity && env.supabaseConfigured ? <SignOutButton /> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Environment"
          action={
            <Badge tone={env.isProduction ? 'success' : 'neutral'}>
              {env.isProduction ? 'production' : 'development'}
            </Badge>
          }
        >
          <KeyValue label="Authentication" value={actor.isDevIdentity ? 'development identity' : 'Supabase Auth'} />
          <KeyValue label="Role" value={roleLabel(actor.role)} />
          <KeyValue label="Organization" value={<span className="font-mono text-xs">{actor.organizationId}</span>} />
          <KeyValue label="Data backend" value={env.dataBackend} />
          <KeyValue
            label="Supabase"
            value={env.supabaseConfigured ? 'configured' : 'not configured'}
          />
          <KeyValue
            label="AI provider"
            value={env.aiEnabled ? `${env.aiProvider} · ${env.aiModel}` : 'not configured'}
          />
          <KeyValue
            label="Email provider"
            value={provider.isConfigured() ? provider.name : 'not configured'}
          />
        </Card>

        <Card title="Manager capabilities">
          {listCapabilities().map((capability) => (
            <KeyValue
              key={capability.id}
              label={capability.name}
              value={
                <Badge
                  tone={
                    capability.status === 'available'
                      ? 'success'
                      : capability.status === 'needs_configuration'
                        ? 'warning'
                        : capability.status === 'assisted'
                          ? 'info'
                          : 'danger'
                  }
                >
                  {capability.status.replace(/_/g, ' ')}
                </Badge>
              }
            />
          ))}
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Status is computed from server configuration. Secret values are not shown. Unsupported and assisted
            capabilities are not described as completed work.
          </p>
        </Card>

        <Card title="Integration status">
          {listAdapters().map((adapter) => (
            <KeyValue
              key={adapter.platform}
              label={adapter.platform}
              value={
                <Badge tone={adapter.configured ? 'success' : 'warning'}>
                  {adapter.configured ? 'configured' : 'not configured'}
                </Badge>
              }
            />
          ))}
        </Card>
      </div>

      <Card title="Effective permissions">
        <p className="mb-3 text-sm text-slate-400">
          Backend enforcement is authoritative. The UI hides actions you cannot perform, but the
          permission guard re-checks every action server-side.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Module</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((module) => (
                <tr key={module} className="border-t border-surface-border/60">
                  <td className="py-2 text-slate-100">{module}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {actionsFor(actor.role, module).length === 0 ? (
                        <span className="text-xs text-slate-500">no access</span>
                      ) : (
                        actionsFor(actor.role, module).map((action) => (
                          <Badge key={action}>{action}</Badge>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
