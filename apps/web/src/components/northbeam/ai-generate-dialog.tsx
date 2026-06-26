'use client';

// AIGenerateDialog — the ⌘K palette's "Generate from prompt" target.
// Object picker + prompt + inline artifact preview using the same walker
// that renders saved dashboard views. "Save as view" persists the artifact
// onto a dashboard view row so the layout is preserved exactly as shown.
//
// Lifecycle:
//   - Generation is read-only and ephemeral until the user explicitly saves
//   - Save creates a `dashboard` view via trpc.view.create
//   - On success: navigate to /<objectKey>?view=<newId> so the saved
//     dashboard opens immediately
//
// The renderer itself doesn't say "AI" anywhere; saved dashboards look
// like any other view in the picker.

import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import { type Artifact, ArtifactView } from '@/components/northbeam/views/artifact-walker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import type { ShareTarget, ViewIcon } from '@northbeam/db/views';
import { BookmarkPlus, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const PLACEHOLDER_PROMPTS = [
  'A workspace snapshot dashboard: total record count, top 4 industries, and a table of the top 5 accounts by revenue.',
  'A renewals page showing deals at risk in the next 30 days as a table, plus pipeline metrics.',
  'A weekly digest: new accounts added, top stages by count, and recent activity highlights.',
];

interface AIGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIGenerateDialog({ open, onOpenChange }: AIGenerateDialogProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const objects = trpc.object.list.useQuery(undefined, { enabled: open });
  const [objectKey, setObjectKey] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const objectId = objects.data?.find((o) => o.key === objectKey)?.id ?? null;

  useEffect(() => {
    if (!open) return;
    if (!objectKey && objects.data && objects.data.length > 0) {
      setObjectKey(objects.data[0]?.key ?? '');
    }
  }, [open, objectKey, objects.data]);

  useEffect(() => {
    if (open) return;
    setArtifact(null);
    setPrompt('');
  }, [open]);

  const generate = trpc.ai.preview.useMutation({
    meta: { context: "Couldn't generate" },
    onSuccess: (data) => setArtifact(data.artifact as Artifact),
  });

  const createView = trpc.view.create.useMutation({
    meta: { context: "Couldn't save the dashboard" },
  });

  const onSaveDialogSubmit = async ({
    label,
    sharedWith,
    icon,
  }: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }) => {
    if (!objectId || !artifact) return;
    const slug =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'dashboard';
    const created = await createView.mutateAsync({
      objectId,
      key: `${slug}-${Date.now().toString(36)}`,
      label,
      type: 'dashboard',
      icon,
      filters: [],
      sort: [],
      columns: [],
      sharedWith,
      // The artifact is the dashboard. Provenance fields are stored so we
      // can surface "regenerate" / "view source prompt" affordances later.
      config: {
        artifact,
        prompt: prompt.trim(),
        generatedAt: new Date().toISOString(),
      },
    });
    await utils.view.list.invalidate({ objectId });
    setSaveDialogOpen(false);
    onOpenChange(false);
    router.push(`/${objectKey}?view=${created?.id ?? ''}`);
  };

  const placeholder = PLACEHOLDER_PROMPTS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Generate from prompt
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-muted-foreground text-xs sm:w-20">Object</span>
            <Select
              value={objectKey}
              onValueChange={(v) => {
                setObjectKey(v);
                setArtifact(null);
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Pick an object" />
              </SelectTrigger>
              <SelectContent>
                {(objects.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.key}>
                    {o.labelPlural}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="resize-y"
          />

          <div className="flex items-center gap-2">
            <Button
              disabled={!prompt.trim() || !objectKey || generate.isPending}
              onClick={() => generate.mutate({ objectKey, prompt: prompt.trim() })}
            >
              {generate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles />}
              {artifact ? 'Regenerate' : 'Generate'}
            </Button>
            {artifact && (
              <Button variant="ghost" onClick={() => setArtifact(null)}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {artifact && (
          <div className="-mx-6 max-h-[60vh] overflow-y-auto border-t bg-muted/20 px-6 py-4">
            <ArtifactView artifact={artifact} />
          </div>
        )}

        <DialogFooter className="border-t px-0 pt-3">
          <span className="mr-auto text-[10px] text-muted-foreground">
            Preview is ephemeral. Save persists the exact layout as a dashboard view.
          </span>
          {artifact && (
            <Button onClick={() => setSaveDialogOpen(true)} disabled={createView.isPending}>
              <BookmarkPlus />
              Save as view
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>

        <SaveViewDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          defaultLabel={prompt.trim().slice(0, 60) || 'Dashboard'}
          defaultIcon="chart"
          isSaving={createView.isPending}
          onSave={onSaveDialogSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
