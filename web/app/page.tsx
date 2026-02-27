import RoiDashboard from "@/components/roi-dashboard";
import { loadRoiSnapshot } from "@/lib/roi-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await loadRoiSnapshot();
  return <RoiDashboard snapshot={snapshot} />;
}
