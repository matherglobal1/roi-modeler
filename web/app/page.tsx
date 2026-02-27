import type { Metadata } from "next";

import RoiDashboard from "@/components/roi-dashboard";
import { loadRoiSnapshot } from "@/lib/roi-data";

export const dynamic = "force-dynamic";

function humanizeClient(clientId?: string): string | undefined {
  if (!clientId) {
    return undefined;
  }
  return clientId.replace(/_\d{6,}$/g, "").replaceAll("_", " ").trim();
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; scenario?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const clientName = humanizeClient(params.client);
  const title = clientName
    ? `ROI Modeller Dashboard | Prepared for ${clientName}`
    : "ROI Modeller Dashboard | Just Global";
  const description = clientName
    ? `Budget allocation strategy dashboard prepared for ${clientName}, powered by Just Global Strategy Team.`
    : "Interactive ROI strategy dashboard powered by Just Global Strategy Team.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

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
