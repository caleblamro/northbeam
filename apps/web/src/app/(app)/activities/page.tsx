'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import { Icon } from '@/components/northbeam/icons';
import { Button } from '@/components/ui/button';
import { ACTIVITIES } from '@/lib/mock-crm';

const ACT_ICON = {
  call: 'phone',
  email: 'envelope-simple',
  note: 'note-pencil',
  stage: 'arrows-clockwise',
  migration: 'upload-simple',
} as const;

export default function ActivitiesPage() {
  return (
    <>
      <PageActions>
        <Button variant="primary" icon="note-pencil">
          Log activity
        </Button>
      </PageActions>

      <div className="panel">
        <div className="panel__body">
          <div className="tl">
            {ACTIVITIES.map((a) => (
              <div className="tl-item" key={a.id}>
                <span className="tl-item__dot">
                  <Icon name={ACT_ICON[a.kind]} />
                </span>
                <div className="tl-item__head">
                  <b>{a.actor}</b>
                  <span style={{ color: 'var(--ink-secondary)' }}>{a.summary}</span>
                  <span className="tl-item__time">{a.time}</span>
                </div>
                {a.detail && <p>{a.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
