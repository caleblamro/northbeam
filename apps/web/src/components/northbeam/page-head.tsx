'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

// The page header (title/subtitle/actions) is owned by the (app) layout
// (see app-shell.tsx). Pages inject actions via <PageActions>. This module
// keeps EmptyState, used inside tables and panels.
export function EmptyState({
  icon = 'squares-four',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 12,
        padding: '64px 24px',
        color: 'var(--ink-muted)',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-lg)',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--surface-sunken)',
          color: 'var(--ink-subtle)',
        }}
      >
        <Icon name={icon} size={24} />
      </div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)' }}>
        {title}
      </div>
      {body && <div style={{ maxWidth: 380, lineHeight: 1.5 }}>{body}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
