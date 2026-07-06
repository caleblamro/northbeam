// The tool-permission contract: code defaults (read tools open, write tools
// admin-only), admin override rows, owner bypass, and per-user friction.
// Plus the approval broker's unknown-call behavior.

import { AI_TOOLS, effectiveTools, toolAllowedForRole } from '@northbeam/core';
import { describe, expect, it } from 'vitest';
import { resolveToolApproval } from '../../src/ai/tools.js';

const readTool = AI_TOOLS.find((t) => t.kind === 'read');
if (!readTool) throw new Error('catalog needs at least one read tool');

describe('toolAllowedForRole', () => {
  it('read tools default allowed for every role', () => {
    for (const role of ['admin', 'member', 'viewer']) {
      expect(toolAllowedForRole([], readTool, role, false), role).toBe(true);
    }
  });

  it('an explicit deny row wins over the default', () => {
    const policy = [{ roleKey: 'viewer', toolId: readTool.id, allowed: false }];
    expect(toolAllowedForRole(policy, readTool, 'viewer', false)).toBe(false);
    expect(toolAllowedForRole(policy, readTool, 'member', false)).toBe(true);
  });

  it('owner bypasses policy entirely', () => {
    const policy = [{ roleKey: 'owner', toolId: readTool.id, allowed: false }];
    expect(toolAllowedForRole(policy, readTool, 'owner', true)).toBe(true);
  });
});

describe('effectiveTools', () => {
  it('applies prefs on top of policy, defaulting read tools to auto-approve', () => {
    const tools = effectiveTools([], [], 'member', false);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.autoApprove, t.id).toBe(t.kind === 'read');
    }
  });

  it('a pref row flips friction without affecting availability', () => {
    const tools = effectiveTools(
      [],
      [{ toolId: readTool.id, autoApprove: false }],
      'member',
      false,
    );
    expect(tools.find((t) => t.id === readTool.id)?.autoApprove).toBe(false);
  });

  it('a denied tool disappears from the effective list', () => {
    const tools = effectiveTools(
      [{ roleKey: 'viewer', toolId: readTool.id, allowed: false }],
      [],
      'viewer',
      false,
    );
    expect(tools.some((t) => t.id === readTool.id)).toBe(false);
  });
});

describe('approval broker', () => {
  it('resolving an unknown call id reports false (timed out / already resolved)', () => {
    expect(resolveToolApproval('00000000-0000-0000-0000-000000000000', true)).toBe(false);
  });
});

describe('write tools', () => {
  const writeTool = AI_TOOLS.find((t) => t.kind === 'write');
  if (!writeTool) throw new Error('catalog needs a write tool for these cases');

  it('default to admin-only availability', () => {
    expect(toolAllowedForRole([], writeTool, 'admin', false)).toBe(true);
    expect(toolAllowedForRole([], writeTool, 'member', false)).toBe(false);
    expect(toolAllowedForRole([], writeTool, 'viewer', false)).toBe(false);
    expect(toolAllowedForRole([], writeTool, 'custom-sales', true)).toBe(true); // owner bypass
  });

  it('an admin grant row opens a write tool for another role', () => {
    const policy = [{ roleKey: 'member', toolId: writeTool.id, allowed: true }];
    expect(toolAllowedForRole(policy, writeTool, 'member', false)).toBe(true);
  });

  it('never auto-approve by default — every call must ask', () => {
    const tools = effectiveTools([], [], 'admin', false);
    for (const t of tools.filter((x) => x.kind === 'write')) {
      expect(t.autoApprove, t.id).toBe(false);
    }
  });
});

describe('destructive tools (delete_record)', () => {
  const destructive = AI_TOOLS.find((t) => t.kind === 'destructive');
  if (!destructive) throw new Error('catalog needs a destructive tool for these cases');

  it('disabled for every role by default — even admin; owner bypasses', () => {
    expect(toolAllowedForRole([], destructive, 'admin', false)).toBe(false);
    expect(toolAllowedForRole([], destructive, 'member', false)).toBe(false);
    expect(toolAllowedForRole([], destructive, 'owner', true)).toBe(true);
  });

  it('an owner-granted policy row opens it for a role', () => {
    const policy = [{ roleKey: 'admin', toolId: destructive.id, allowed: true }];
    expect(toolAllowedForRole(policy, destructive, 'admin', false)).toBe(true);
  });

  it('requires approval for everyone except owners; owners auto-approve by default', () => {
    const granted = [{ roleKey: 'admin', toolId: destructive.id, allowed: true }];
    const admin = effectiveTools(granted, [], 'admin', false).find((t) => t.id === destructive.id);
    expect(admin?.autoApprove).toBe(false);
    const owner = effectiveTools([], [], 'owner', true).find((t) => t.id === destructive.id);
    expect(owner?.autoApprove).toBe(true);
  });

  it('even an owner can opt into asking every time', () => {
    const owner = effectiveTools(
      [],
      [{ toolId: destructive.id, autoApprove: false }],
      'owner',
      true,
    ).find((t) => t.id === destructive.id);
    expect(owner?.autoApprove).toBe(false);
  });
});
