import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { loadRoiSnapshot } from "@/lib/roi-data";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function runPythonModel(repoRoot: string, clientId: string, objective: string): Promise<void> {
  const attempts: Array<{ command: string; args: string[] }> = [
    {
      command: process.env.PYTHON_BIN || "python",
      args: ["scripts/run_optimizer.py", "--client", clientId, "--objective", objective, "--output-dir", "data/canonical/outputs"],
    },
  ];
  if (process.platform === "win32") {
    attempts.push({
      command: "py",
      args: ["-3", "scripts/run_optimizer.py", "--client", clientId, "--objective", objective, "--output-dir", "data/canonical/outputs"],
    });
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await execFileAsync(attempt.command, attempt.args, {
        cwd: repoRoot,
        windowsHide: true,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const live = url.searchParams.get("live") !== "0";
  const clientId = url.searchParams.get("client") ?? "autodesk";
  const objective = url.searchParams.get("objective") ?? "pipeline";

  let source: "live" | "demo" = "live";
  if (live) {
    try {
      const repoRoot = path.resolve(process.cwd(), "..");
      await runPythonModel(repoRoot, clientId, objective);
    } catch {
      source = "demo";
    }
  }

  const snapshot = await loadRoiSnapshot();
  const payload = source === "demo" ? { ...snapshot, source: "demo" as const } : { ...snapshot, source: "live" as const };
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
