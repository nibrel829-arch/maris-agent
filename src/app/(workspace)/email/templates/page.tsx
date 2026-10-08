import Link from 'next/link';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { CreateTemplateForm } from '@/features/email/CreateTemplateForm';
import { TemplateToolbar } from '@/features/email/TemplateToolbar';
import { TemplateStatusBadge } from '@/features/email/TemplateStatusBadge';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { listTemplates } from '@/server/email/service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

function pageHref(search: string, status: string, category: string, page: number): string {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `/email/templates?${text}` : '/email/templates';
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function EmailTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; category?: string; page?: string }>;
}) {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view email templates." />;
  }

  const raw = await searchParams;
  const search = (raw.search ?? '').trim().slice(0, 200);
  const status = (raw.status ?? '').trim();
  const category = (raw.category ?? '').trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(raw.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const canCreate = checkPermission(actor, { module: 'email', action: 'create' }).allowed;

  const result = await listTemplates(actor, repo, {
    search: search || undefined,
    category: category || undefined,
    status: (status as 'draft' | 'active' | 'archived') || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-[1380px] space-y-6">
        <PageHeader description="Organization-owned reusable messages with variables, lifecycle and preview." title="Email templates" />
        <ErrorState message={result.error.message} />
      </div>
    );
  }

  const { templates, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, safePage * PAGE_SIZE);
  const isFiltered = search.length > 0 || status.length > 0 || category.length > 0;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Organization-owned templates — name, subject, body, variables, draft/active/archived lifecycle, search/filter, tenant isolation. Archived templates cannot be accidentally selected for sending."
        title="Email templates"
        actions={<Link className="btn-secondary" href="/email">Back to email workspace <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card
          title="Template directory"
          action={total > 0 ? <Badge tone="info">{total} template{total === 1 ? '' : 's'}</Badge> : null}
        >
          <div className="mb-4">
            <TemplateToolbar search={search} status={status} category={category} />
          </div>

          {templates.length === 0 ? (
            <EmptyState
              description={
                isFiltered
                  ? 'No templates match this search. Clear the search or try a different status/category.'
                  : 'No templates have been created. Create the first one to start reusing messages.'
              }
              icon={<DocumentIcon size={19} />}
              title={isFiltered ? 'No matching templates' : 'No templates yet'}
              action={isFiltered ? <Link className="btn-secondary" href="/email/templates">Clear search</Link> : undefined}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="table-header">
                    <tr>
                      <th className="px-2 py-3">Template</th>
                      <th className="px-2 py-3">Subject</th>
                      <th className="px-2 py-3">Status</th>
                      <th className="px-2 py-3">Variables</th>
                      <th className="px-2 py-3">Updated</th>
                      <th className="px-2 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((tpl) => (
                      <tr key={tpl.id} className="table-row">
                        <td className="px-2 py-3">
                          <Link className="font-medium text-slate-100 hover:underline" href={`/email/templates/${tpl.id}`}>
                            {tpl.name}
                          </Link>
                          <p className="mt-0.5 text-xs text-slate-500">{tpl.category}</p>
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-400">{tpl.subject.slice(0, 80)}</td>
                        <td className="px-2 py-3">
                          <TemplateStatusBadge status={tpl.status ?? (tpl.archived ? 'archived' : 'active')} />
                        </td>
                        <td className="px-2 py-3 font-mono text-[11px] text-slate-500">
                          {tpl.variables.length ? tpl.variables.map((v) => `{{${v}}}`).join(' ') : '—'}
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-500">{formatDate(tpl.updated_at)}</td>
                        <td className="px-2 py-3 text-right">
                          <Link className="btn-ghost text-xs" href={`/email/templates/${tpl.id}`}>
                            View <ArrowRightIcon size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-border/60 pt-4">
                <p className="text-xs text-slate-500">
                  Showing {from}–{to} of {total}
                </p>
                <div className="flex items-center gap-2">
                  {safePage > 1 ? (
                    <Link className="btn-secondary px-3 py-1.5 text-xs" href={pageHref(search, status, category, safePage - 1)}>
                      Previous
                    </Link>
                  ) : null}
                  <span className="text-xs text-slate-500">
                    Page {safePage} of {totalPages}
                  </span>
                  {safePage < totalPages ? (
                    <Link className="btn-secondary px-3 py-1.5 text-xs" href={pageHref(search, status, category, safePage + 1)}>
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </Card>

        <aside className="space-y-6">
          {canCreate ? (
            <Card title="New template">
              <CreateTemplateForm />
            </Card>
          ) : (
            <Card title="New template">
              <EmptyState
                title="Creation not permitted"
                description="Your role cannot create templates (requires email:create). Ask an owner or admin."
              />
            </Card>
          )}
          <Card title="About variables">
            <ul className="space-y-2 text-xs leading-5 text-slate-400">
              <li>• Use {'{{client.name}}'}, {'{{client.company}}'}, {'{{user.name}}'} etc.</li>
              <li>• Malformed placeholders (empty, unclosed, invalid chars) are rejected with 400.</li>
              <li>• Preview resolves variables before sending — unresolved ones block delivery.</li>
              <li>• Draft templates are preview-only; only active ones can be sent.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
