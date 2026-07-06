'use client';

// Full-bleed flow editor route — a top-level route (not under /setup) because
// SetupShell's sidebar grid can't be opted out; the editor owns its own slim
// header. <HidePageHead/> suppresses the layout header, and the negative
// margins undo .app-wrap's padding so the canvas fills the content area
// (100vh minus the 52px shellbar + hairline).

import { HidePageHead } from '@/components/northbeam/app-shell';
import { FlowEditor } from '@/components/northbeam/automation/flow-editor';
import { useParams } from 'next/navigation';

export default function AutomationEditorPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <HidePageHead />
      <div className="-mx-8 -mt-7 -mb-20 h-[calc(100vh-53px)]">
        <FlowEditor flowId={params.id} />
      </div>
    </>
  );
}
