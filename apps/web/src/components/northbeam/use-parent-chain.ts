'use client';

// Walks a record's reference fields upward (≤3 hops) to build the record
// page's parent-chain breadcrumb: Accounts / Acme Corp / Deals / Acme renewal.
// Fetches go through the tRPC utils cache so revisits are free; any failure
// just truncates the chain and the breadcrumb falls back to what resolved.

import { trpc } from '@/lib/api';
import { useEffect, useState } from 'react';
import type { FieldDefLite } from './field-render';

export type ParentCrumb = {
  objectKey: string;
  objectLabel: string;
  objectLabelPlural: string;
  objectColor: string;
  id: string;
  name: string;
};

const MAX_HOPS = 3;

/** The reference to follow upward: first *set* reference field, preferring
 *  keys `account` then `parent`/`parent_*`, else field order. */
function pickParentRef(
  fields: FieldDefLite[],
  data: Record<string, unknown>,
): { targetObject: string; id: string } | null {
  const refs = fields.filter((f) => {
    const v = data[f.key];
    return f.type === 'reference' && !!f.config?.targetObject && v != null && v !== '';
  });
  const preferred =
    refs.find((f) => f.key === 'account') ??
    refs.find((f) => f.key === 'parent' || f.key.startsWith('parent_')) ??
    refs[0];
  if (!preferred) return null;
  return {
    targetObject: preferred.config?.targetObject as string,
    id: String(data[preferred.key]),
  };
}

export function useParentChain({
  objectKey,
  recordId,
  fields,
  data,
}: {
  objectKey: string;
  recordId: string;
  fields: FieldDefLite[] | undefined;
  data: Record<string, unknown> | undefined;
}): ParentCrumb[] {
  const utils = trpc.useUtils();
  const [chain, setChain] = useState<ParentCrumb[]>([]);

  useEffect(() => {
    if (!fields || !data) {
      setChain([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const crumbs: ParentCrumb[] = [];
      const visited = new Set([`${objectKey}:${recordId}`]);
      let curFields = fields;
      let curData = data;
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        const parent = pickParentRef(curFields, curData);
        if (!parent || visited.has(`${parent.targetObject}:${parent.id}`)) break;
        visited.add(`${parent.targetObject}:${parent.id}`);
        try {
          const res = await utils.record.get.fetch({
            objectKey: parent.targetObject,
            id: parent.id,
          });
          crumbs.unshift({
            objectKey: res.object.key,
            objectLabel: res.object.label,
            objectLabelPlural: res.object.labelPlural,
            objectColor: res.object.color,
            id: res.row.id,
            name: res.row.name,
          });
          curFields = res.fields as FieldDefLite[];
          curData = res.row.data as Record<string, unknown>;
        } catch {
          break;
        }
      }
      if (!cancelled) setChain(crumbs);
    })();
    return () => {
      cancelled = true;
    };
  }, [objectKey, recordId, fields, data, utils]);

  return chain;
}
