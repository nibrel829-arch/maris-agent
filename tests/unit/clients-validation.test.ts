import { describe, expect, it } from 'vitest';
import {
  addClientNoteSchema,
  clientIdSchema,
  clientListQuerySchema,
  createClientSchema,
  updateClientSchema,
} from '@/server/clients/validation';

describe('Clients validation', () => {
  it('accepts a minimal create payload and applies defaults', () => {
    const parsed = createClientSchema.parse({ name: 'Acme Clinic' });
    expect(parsed.name).toBe('Acme Clinic');
    expect(parsed.status).toBe('lead');
    expect(parsed.tags).toEqual([]);
    expect(parsed.email).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });

  it('accepts the full Phase 5 field set', () => {
    const parsed = createClientSchema.parse({
      name: 'Ayesha Khan',
      company: 'Northwind Dental',
      email: 'ayesha@example.com',
      phone: '+1 555 010 2030',
      status: 'prospect',
      notes: 'Prefers morning calls.',
      tags: ['vip', 'referral'],
    });
    expect(parsed).toMatchObject({
      name: 'Ayesha Khan',
      company: 'Northwind Dental',
      email: 'ayesha@example.com',
      phone: '+1 555 010 2030',
      status: 'prospect',
      notes: 'Prefers morning calls.',
      tags: ['vip', 'referral'],
    });
  });

  it('accepts every supported status including pre-Phase-5 values', () => {
    for (const status of [
      'lead',
      'prospect',
      'qualified',
      'active',
      'paused',
      'inactive',
      'churned',
      'completed',
    ]) {
      expect(createClientSchema.parse({ name: 'X', status }).status).toBe(status);
    }
  });

  it('strips tenancy and identity keys instead of trusting the browser', () => {
    const parsed = createClientSchema.parse({
      name: 'Sneaky',
      organization_id: '00000000-0000-0000-0000-000000000002',
      created_by: '00000000-0000-0000-0000-0000000000ff',
      id: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(parsed).not.toHaveProperty('organization_id');
    expect(parsed).not.toHaveProperty('created_by');
    expect(parsed).not.toHaveProperty('id');
  });

  it('rejects invalid create payloads with useful messages', () => {
    expect(() => createClientSchema.parse({ name: '' })).toThrow('Client name is required.');
    expect(() => createClientSchema.parse({ name: '   ' })).toThrow('Client name is required.');
    expect(() => createClientSchema.parse({ name: 'X', email: 'not-an-email' })).toThrow(
      'Enter a valid email address.',
    );
    expect(() => createClientSchema.parse({ name: 'X', phone: 'abc' })).toThrow(
      'Enter a valid phone number.',
    );
    expect(() => createClientSchema.parse({ name: 'X', status: 'archived' })).toThrow();
    expect(() => createClientSchema.parse({ name: 'X', notes: 'n'.repeat(5001) })).toThrow(
      'Notes must be 5000 characters or fewer.',
    );
  });

  it('requires at least one change for updates', () => {
    expect(() => updateClientSchema.parse({})).toThrow('No changes supplied.');
    const parsed = updateClientSchema.parse({ status: 'completed' });
    expect(parsed.status).toBe('completed');
    expect(() => updateClientSchema.parse({ email: 'bad' })).toThrow(
      'Enter a valid email address.',
    );
  });

  it('coerces list query params with safe bounds', () => {
    const parsed = clientListQuerySchema.parse({
      search: 'acme',
      status: 'active',
      limit: '10',
      offset: '20',
    });
    expect(parsed).toMatchObject({ search: 'acme', status: 'active', limit: 10, offset: 20 });

    const defaults = clientListQuerySchema.parse({});
    expect(defaults).toMatchObject({ limit: 20, offset: 0 });

    expect(() => clientListQuerySchema.parse({ limit: '500' })).toThrow();
    expect(() => clientListQuerySchema.parse({ offset: '-1' })).toThrow();
    expect(() => clientListQuerySchema.parse({ status: 'archived' })).toThrow();
  });

  it('validates note payloads and client ids', () => {
    expect(() => addClientNoteSchema.parse({ subject: '' })).toThrow(
      'A note subject is required.',
    );
    expect(addClientNoteSchema.parse({ subject: 'Call' })).toMatchObject({ subject: 'Call' });
    expect(clientIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(clientIdSchema.safeParse('00000000-0000-0000-0000-000000000001').success).toBe(true);
  });
});
