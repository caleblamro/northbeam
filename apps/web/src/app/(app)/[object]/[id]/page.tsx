import { RecordView } from '@/components/northbeam/record-view';

// Generic record detail page. `[object]` is the object key (e.g. 'contact'),
// `[id]` the record id. Works for every object via the metadata layer.
export default async function RecordPage({
  params,
}: {
  params: Promise<{ object: string; id: string }>;
}) {
  const { object, id } = await params;
  return <RecordView objectKey={object} id={id} />;
}
