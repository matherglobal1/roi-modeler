import { NextResponse } from "next/server";

import { loadRoiSnapshot } from "@/lib/roi-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await loadRoiSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
