import { RecordListView } from '@/components/northbeam/record-list-view';

// Generic list page for any object by key — this is how imported/custom objects
// (e.g. /property, /contract) get a home without a hand-written route. Static
// routes (/contacts, /accounts, …) take precedence over this dynamic segment.
export default async function ObjectListPage({
  params,
}: {
  params: Promise<{ object: string }>;
}) {
  const { object } = await params;
  return <RecordListView objectKey={object} />;
}
