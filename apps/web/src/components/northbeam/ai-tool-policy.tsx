'use client';

// AiToolPolicyMatrix — Setup → Roles' companion card: which AI research tools
// each role may use. Columns are the org's roles (system + custom), rows are
// the tool catalog; a checkbox writes one override row. Unchecked doesn't
// hide data the role could already query by hand — it only removes the tool
// from that role's AI. Owner always has everything (column omitted).

import { SectionCard } from '@/components/northbeam/section-card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import { AI_TOOLS, toolAllowedForRole } from '@northbeam/core/ai-tools';
import { Wrench } from 'lucide-react';

export function AiToolPolicyMatrix() {
  const utils = trpc.useUtils();
  const roles = trpc.role.list.useQuery();
  const policy = trpc.ai.toolPolicyList.useQuery();
  const setPolicy = trpc.ai.toolPolicySet.useMutation({
    meta: { context: "Couldn't update the tool policy" },
    onSuccess: () => utils.ai.toolPolicyList.invalidate(),
  });

  if (roles.isLoading || policy.isLoading) {
    return <Skeleton className="h-40 rounded-lg" />;
  }
  const overrides = policy.data?.overrides ?? [];
  // Owner is omitted — it always passes every check.
  const cols = (roles.data ?? []).filter((r) => r.key !== 'owner');

  return (
    <SectionCard icon={Wrench} title="AI research tools">
      <p className="mb-3 text-muted-foreground text-xs">
        What each role's AI may look at while composing. Members choose their own auto-approval on
        top of this; unchecking never blocks data a role can already query by hand.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th className="py-2 pr-4 font-medium">Tool</th>
              {cols.map((r) => (
                <th key={r.id} className="px-2 py-2 text-center font-medium">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AI_TOOLS.map((tool) => (
              <tr key={tool.id} className="border-b last:border-0">
                <td className="max-w-72 py-2 pr-4">
                  <p className="font-medium text-xs">{tool.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                    {tool.description}
                  </p>
                </td>
                {cols.map((r) => {
                  const allowed = toolAllowedForRole(overrides, tool, r.key, false);
                  return (
                    <td key={r.id} className="px-2 py-2 text-center align-middle">
                      <Checkbox
                        checked={allowed}
                        disabled={setPolicy.isPending}
                        aria-label={`${tool.title} for ${r.name}`}
                        onCheckedChange={(on) =>
                          setPolicy.mutate({
                            roleKey: r.key,
                            toolId: tool.id,
                            allowed: on === true,
                          })
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
