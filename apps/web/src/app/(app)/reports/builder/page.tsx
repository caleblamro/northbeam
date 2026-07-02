import { ReportBuilder } from '@/components/northbeam/report-builder';

// Report builder — compose a `report` view (object + group-by + measure +
// filters + chart) with a live preview. `?edit=<viewId>` loads an existing
// report for round-trip editing.
export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  return <ReportBuilder editViewId={edit} />;
}
