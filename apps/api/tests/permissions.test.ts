// Unit coverage for the custom-role permission model: system-role seeds match
// the legacy static matrix, and the resolver primitives (canOrg / canObject)
// honor org actions, object defaults, per-object overrides, and owner.

import {
  type CrudGrant,
  SYSTEM_ROLE_SEEDS,
  canObject,
  canOrg,
  resolveFromStatic,
  resolvePermissions,
} from '@northbeam/core';
import { describe, expect, it } from 'vitest';

function seedFor(key: string) {
  const s = SYSTEM_ROLE_SEEDS.find((r) => r.key === key);
  if (!s) throw new Error(`no seed for ${key}`);
  return s;
}

describe('system role seeds', () => {
  it('reproduce the legacy rank-based CRUD defaults', () => {
    expect(seedFor('owner').defaultGrant).toEqual<CrudGrant>({
      create: true,
      read: true,
      update: true,
      delete: true,
    });
    expect(seedFor('admin').defaultGrant).toEqual<CrudGrant>({
      create: true,
      read: true,
      update: true,
      delete: true,
    });
    // member can create/edit but not delete
    expect(seedFor('member').defaultGrant).toEqual<CrudGrant>({
      create: true,
      read: true,
      update: true,
      delete: false,
    });
    // viewer is read-only
    expect(seedFor('viewer').defaultGrant).toEqual<CrudGrant>({
      create: false,
      read: true,
      update: false,
      delete: false,
    });
  });

  it('grant org actions by rank (admin manages roles, member/viewer do not)', () => {
    expect(seedFor('admin').orgPermissions).toContain('org.roles.manage');
    expect(seedFor('admin').orgPermissions).toContain('object.manage');
    expect(seedFor('member').orgPermissions).not.toContain('object.manage');
    expect(seedFor('viewer').orgPermissions).toContain('view.read');
    expect(seedFor('viewer').orgPermissions).not.toContain('view.write');
    // record.* keys are NOT org permissions — they became the CRUD grid.
    expect(seedFor('admin').orgPermissions).not.toContain('record.read' as never);
  });
});

describe('canOrg / canObject resolution', () => {
  it('owner passes every check', () => {
    const owner = resolveFromStatic('owner');
    expect(canOrg(owner, 'org.delete')).toBe(true);
    expect(canObject(owner, 'any-object-id', 'delete')).toBe(true);
  });

  it('viewer can read but not write any object', () => {
    const viewer = resolveFromStatic('viewer');
    expect(canObject(viewer, 'obj1', 'read')).toBe(true);
    expect(canObject(viewer, 'obj1', 'update')).toBe(false);
    expect(canObject(viewer, 'obj1', 'create')).toBe(false);
    expect(canOrg(viewer, 'object.manage')).toBe(false);
  });

  it('an unknown custom key with no row resolves to no access', () => {
    const stranger = resolveFromStatic('sales-rep');
    expect(canOrg(stranger, 'view.read')).toBe(false);
    expect(canObject(stranger, 'obj1', 'read')).toBe(false);
  });

  it('per-object overrides beat the role default', () => {
    const resolved = resolvePermissions({
      roleKey: 'sales-rep',
      orgPermissions: ['view.read'],
      // default: read-only everywhere…
      defaultGrant: { create: false, read: true, update: false, delete: false },
      // …but full CRUD on the "deal" object specifically.
      objectOverrides: new Map([
        ['deal-id', { create: true, read: true, update: true, delete: true }],
      ]),
    });
    expect(canObject(resolved, 'contact-id', 'update')).toBe(false); // falls to default
    expect(canObject(resolved, 'deal-id', 'delete')).toBe(true); // override
    expect(canOrg(resolved, 'view.read')).toBe(true);
    expect(canOrg(resolved, 'view.write')).toBe(false);
  });
});
