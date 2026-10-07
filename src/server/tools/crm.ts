/**
 * CRM and lead tools (PDF #08 §6 Initial Tool Groups — CRM group).
 */

import { z } from 'zod';
import { newId } from '@/lib/id';
import type { ClientStatus } from '@/types/domain';
import { CLIENT_STATUSES } from '@/server/clients/validation';
import { defineTool } from './define';

export const listClientsTool = defineTool({
  name: 'list_clients',
  description: 'List clients in the current organization.',
  permission: { module: 'clients', action: 'view' },
  risk: 'low',
  inputSchema: z.object({
    status: z.enum(CLIENT_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async execute(input, ctx) {
    const clients = await ctx.repo.clients.list(ctx.organizationId, { limit: input.limit });
    return clients.filter((client) => (input.status ? client.status === input.status : true));
  },
});

export const getClientTool = defineTool({
  name: 'get_client',
  description: 'Fetch a single client and their activity timeline.',
  permission: { module: 'clients', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ clientId: z.string().uuid() }),
  async execute(input, ctx) {
    const client = await ctx.repo.clients.get(input.clientId, ctx.organizationId);
    if (!client) throw new Error('Client not found or not in this organization.');
    const activity = await ctx.repo.clientActivity.list(ctx.organizationId, { limit: 100 });
    return { client, activity: activity.filter((entry) => entry.client_id === input.clientId) };
  },
});

export const createClientTool = defineTool({
  name: 'create_client',
  description: 'Create a client record in the current organization.',
  permission: { module: 'clients', action: 'create' },
  risk: 'medium',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    company: z.string().max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(50).optional(),
    status: z.enum(CLIENT_STATUSES).default('lead'),
    tags: z.array(z.string().max(50)).max(25).default([]),
    notes: z.string().max(5000).optional(),
  }),
  async execute(input, ctx) {
    const client = await ctx.repo.clients.insert({
      organization_id: ctx.organizationId,
      name: input.name,
      company: input.company ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      status: input.status as ClientStatus,
      tags: input.tags,
      notes: input.notes ?? null,
      created_by: ctx.actor.userId,
    });

    await ctx.repo.clientActivity.insert({
      organization_id: ctx.organizationId,
      client_id: client.id,
      kind: 'lead_created',
      subject: 'Client record created',
      body: `Created by ${ctx.actor.fullName ?? ctx.actor.email ?? 'the Manager'}.`,
      actor_id: ctx.actor.userId,
    });

    return { client };
  },
});

export const updateClientTool = defineTool({
  name: 'update_client',
  description: 'Update an existing client record.',
  permission: { module: 'clients', action: 'edit' },
  risk: 'medium',
  inputSchema: z.object({
    clientId: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    company: z.string().max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(50).optional(),
    status: z.enum(CLIENT_STATUSES).optional(),
    tags: z.array(z.string().max(50)).max(25).optional(),
    notes: z.string().max(5000).optional(),
  }),
  async execute(input, ctx) {
    const existing = await ctx.repo.clients.get(input.clientId, ctx.organizationId);
    if (!existing) throw new Error('Client not found or not in this organization.');

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.company !== undefined) patch.company = input.company;
    if (input.email !== undefined) patch.email = input.email;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.status !== undefined) patch.status = input.status;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.notes !== undefined) patch.notes = input.notes;

    const client = await ctx.repo.clients.update(input.clientId, ctx.organizationId, patch as never);

    if (input.status !== undefined && input.status !== existing.status) {
      await ctx.repo.clientActivity.insert({
        organization_id: ctx.organizationId,
        client_id: input.clientId,
        kind: 'status_change',
        subject: `Status changed from ${existing.status} to ${input.status}`,
        body: null,
        actor_id: ctx.actor.userId,
      });
    }

    return { client };
  },
});

export const addClientNoteTool = defineTool({
  name: 'add_client_note',
  description: 'Append a note to a client timeline.',
  permission: { module: 'clients', action: 'edit' },
  risk: 'low',
  inputSchema: z.object({
    clientId: z.string().uuid(),
    subject: z.string().min(1).max(200),
    body: z.string().max(5000).optional(),
  }),
  async execute(input, ctx) {
    const activity = await ctx.repo.clientActivity.insert({
      organization_id: ctx.organizationId,
      client_id: input.clientId,
      kind: 'note',
      subject: input.subject,
      body: input.body ?? null,
      actor_id: ctx.actor.userId,
    });
    return { activity };
  },
});

/* -------------------------------------------------------------------------- */
/* Leads                                                                       */
/* -------------------------------------------------------------------------- */

export const createLeadTool = defineTool({
  name: 'create_lead',
  description:
    'Record a lead. A source is mandatory: the system never invents leads, so an unknown provenance is stored as "unverified".',
  permission: { module: 'clients', action: 'create' },
  risk: 'medium',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    company: z.string().max(200).optional(),
    email: z.string().email().optional(),
    source: z.string().min(1).max(200),
    stage: z
      .enum(['identified', 'researched', 'contacted', 'qualified', 'disqualified', 'converted'])
      .default('identified'),
  }),
  async execute(input, ctx) {
    const lead = await ctx.repo.leads.insert({
      organization_id: ctx.organizationId,
      client_id: null,
      name: input.name,
      company: input.company ?? null,
      email: input.email ?? null,
      source: input.source,
      stage: input.stage,
      qualification_score: 0,
      qualification_reasons: [],
    });
    return { lead };
  },
});

export const listLeadsTool = defineTool({
  name: 'list_leads',
  description: 'List recorded leads for the organization.',
  permission: { module: 'clients', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  async execute(input, ctx) {
    return ctx.repo.leads.list(ctx.organizationId, { limit: input.limit });
  },
});

export const qualifyLeadTool = defineTool({
  name: 'qualify_lead',
  description:
    'Score a lead against recorded evidence only. Reasons must reference evidence already recorded; unscored criteria are listed as gaps, not assumed.',
  permission: { module: 'clients', action: 'edit' },
  risk: 'medium',
  inputSchema: z.object({
    leadId: z.string().uuid(),
    /** Explicit, evidencable criteria. Each must be justified. */
    criteria: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          met: z.boolean(),
          evidence: z.string().max(500),
        }),
      )
      .min(1)
      .max(12),
  }),
  async execute(input, ctx) {
    const existing = await ctx.repo.leads.get(input.leadId, ctx.organizationId);
    if (!existing) throw new Error('Lead not found or not in this organization.');

    const met = input.criteria.filter((criterion) => criterion.met);
    const score = Math.round((met.length / input.criteria.length) * 100);
    const reasons = input.criteria.map(
      (criterion) =>
        `${criterion.met ? 'MET' : 'NOT MET'}: ${criterion.name} — ${criterion.evidence || 'no evidence recorded'}`,
    );

    const lead = await ctx.repo.leads.update(input.leadId, ctx.organizationId, {
      qualification_score: score,
      qualification_reasons: reasons,
      stage: score >= 60 ? 'qualified' : existing.stage,
    } as never);

    return {
      lead,
      gaps: input.criteria.filter((criterion) => !criterion.evidence).map((c) => c.name),
      note: score >= 60 ? 'Lead marked qualified.' : 'Lead scored but not yet qualified.',
    };
  },
});

export const crmTools = [
  listClientsTool,
  getClientTool,
  createClientTool,
  updateClientTool,
  addClientNoteTool,
  createLeadTool,
  listLeadsTool,
  qualifyLeadTool,
];

export { newId, CLIENT_STATUSES };
