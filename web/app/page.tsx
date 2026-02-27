import RoiDashboard from "@/components/roi-dashboard";
import { loadRoiSnapshot } from "@/lib/roi-data";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; scenario?: string }>;
}) {
  const snapshot = await loadRoiSnapshot();
  const params = await searchParams;
  return (
    <RoiDashboard
      snapshot={snapshot}
      initialClientId={params.client}
      initialScenarioId={params.scenario}
    />
  );
}
