import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { loadRoiSnapshot } from "@/lib/roi-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const OBJECTIVES = ["pipeline", "revenue", "roas", "cac"];

type CsvRow = Record<string, string>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function parseNumber(raw: string | undefined, fallback = 0): number {
  if (!raw) {
    return fallback;
  }
  const cleaned = raw.replace(/[$,%\s,]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

function csvStringify(rows: Array<Record<string, string | number | boolean | null>>): string {
  if (!rows.length) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }
    const text = String(value);
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
}

async function runPythonScript(repoRoot: string, scriptPath: string, args: string[]): Promise<void> {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: process.env.PYTHON_BIN || "python", args: [scriptPath, ...args] },
  ];
  if (process.platform === "win32") {
    attempts.push({ command: "py", args: ["-3", scriptPath, ...args] });
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

async function ensureClientConfig(
  repoRoot: string,
  clientId: string,
  totalBudget: number,
): Promise<void> {
  const configPath = path.join(repoRoot, "configs", "clients", `${clientId}.yaml`);
  const payload = `client_id: ${clientId}
description: Uploaded dataset for ${clientId}.
data:
  performance_csv: data/canonical/${clientId}_performance.csv
  baseline_csv: data/canonical/${clientId}_channel_baseline.csv
  constraints_csv: data/canonical/${clientId}_constraints.csv
run_defaults:
  objective: pipeline
  total_budget: ${Math.round(totalBudget)}
  guardrails:
    min_roas: null
    max_cac: null
`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, payload, "utf8");
}

function pickFirst(row: CsvRow, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && String(direct).trim().length > 0) {
      return direct;
    }
    const lower = row[key.toLowerCase()];
    if (lower !== undefined && String(lower).trim().length > 0) {
      return lower;
    }
  }
  return undefined;
}

function buildCanonicalFromCsv(rows: CsvRow[], clientId: string) {
  const normalizedRows = rows
    .map((row) => {
      const channel = pickFirst(row, ["channel", "Channel", "name", "Name"]);
      const spend = parseNumber(
        pickFirst(row, ["baseline_spend", "recommended_spend", "spend", "budget", "Budget"]),
        0,
      );
      if (!channel || spend <= 0) {
        return null;
      }
      const beta = parseNumber(pickFirst(row, ["beta", "Beta"]), 0.72);
      const pipeline = parseNumber(
        pickFirst(row, ["pipeline_sourced", "pipeline", "pred_pipeline"]),
        spend * 320,
      );
      const revenue = parseNumber(
        pickFirst(row, ["cw_acv_sourced", "revenue", "pred_revenue"]),
        spend * 95,
      );
      const hqls = parseNumber(pickFirst(row, ["hqls", "pred_hqls"]), Math.max(1, spend / 2.1));
      const leads = parseNumber(pickFirst(row, ["engaged_leads", "pred_leads", "leads"]), hqls * 2.1);
      const alphaPipeline = parseNumber(pickFirst(row, ["alpha_pipeline"]), pipeline / spend ** beta);
      const alphaRevenue = parseNumber(pickFirst(row, ["alpha_revenue"]), revenue / spend ** beta);
      const alphaHqls = parseNumber(pickFirst(row, ["alpha_hqls"]), hqls / spend ** beta);
      const alphaLeads = parseNumber(pickFirst(row, ["alpha_leads"]), leads / spend ** beta);

      return {
        channel: channel.trim(),
        baseline_spend: spend,
        beta,
        pipeline_sourced: pipeline,
        cw_acv_sourced: revenue,
        hqls,
        engaged_leads: leads,
        opps_sourced: parseNumber(pickFirst(row, ["opps_sourced"]), Math.max(1, hqls * 0.18)),
        alpha_pipeline: alphaPipeline,
        alpha_revenue: alphaRevenue,
        alpha_hqls: alphaHqls,
        alpha_leads: alphaLeads,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const totalBudget = normalizedRows.reduce((sum, row) => sum + row.baseline_spend, 0);
  const baselineRows = normalizedRows.map((row) => ({
    client_id: clientId,
    channel: row.channel,
    baseline_spend: Number(row.baseline_spend.toFixed(2)),
    baseline_share: totalBudget > 0 ? Number((row.baseline_spend / totalBudget).toFixed(6)) : 0,
    engaged_leads: Number(row.engaged_leads.toFixed(2)),
    hqls: Number(row.hqls.toFixed(2)),
    opps_sourced: Number(row.opps_sourced.toFixed(2)),
    pipeline_sourced: Number(row.pipeline_sourced.toFixed(2)),
    cw_acv_sourced: Number(row.cw_acv_sourced.toFixed(2)),
    roas_baseline: Number((row.cw_acv_sourced / Math.max(1, row.baseline_spend)).toFixed(4)),
    cac_baseline: Number((row.baseline_spend / Math.max(1, row.hqls)).toFixed(4)),
    beta: Number(row.beta.toFixed(4)),
    alpha_pipeline: Number(row.alpha_pipeline.toFixed(6)),
    alpha_revenue: Number(row.alpha_revenue.toFixed(6)),
    alpha_hqls: Number(row.alpha_hqls.toFixed(6)),
    alpha_leads: Number(row.alpha_leads.toFixed(6)),
    notes: "Generated from uploaded CSV.",
  }));

  const constraintsRows = baselineRows.map((row) => {
    const minSpend = row.baseline_spend * 0.4;
    const rawMax = Math.max(row.baseline_spend * 1.8, totalBudget * 0.1);
    const maxSpend = Math.min(rawMax, totalBudget * 0.75);
    return {
      client_id: clientId,
      channel: row.channel,
      enabled: true,
      min_spend: Number(minSpend.toFixed(2)),
      max_spend: Number(maxSpend.toFixed(2)),
      locked_spend: "",
      min_share: totalBudget > 0 ? Number((minSpend / totalBudget).toFixed(6)) : "",
      max_share: totalBudget > 0 ? Number((maxSpend / totalBudget).toFixed(6)) : "",
      min_roas: Number((row.roas_baseline * 0.7).toFixed(4)),
      max_cac: Number((row.cac_baseline * 1.4).toFixed(4)),
      notes: "Auto-generated hard caps.",
    };
  });

  const now = new Date().toISOString();
  const performanceRows = baselineRows.map((row) => ({
    client_id: clientId,
    geo: "Global",
    channel: row.channel,
    sub_channel: row.channel,
    platform: "Uploaded CSV",
    fiscal_year: new Date().getFullYear(),
    fiscal_quarter: "Q1",
    quarter_label: "Q1",
    period_start: `${new Date().getFullYear()}-01-01`,
    engaged_leads: row.engaged_leads,
    hqls: row.hqls,
    opps_sourced: row.opps_sourced,
    pipeline_sourced: row.pipeline_sourced,
    pipeline_influenced: row.pipeline_sourced,
    cw_opps_sourced: row.opps_sourced,
    cw_acv_sourced: row.cw_acv_sourced,
    cw_acv_influenced: row.cw_acv_sourced,
    hql_to_opp_conversion: row.hqls > 0 ? Number((row.opps_sourced / row.hqls).toFixed(4)) : 0,
    source_file: "uploaded.csv",
    ingested_at: now,
  }));

  return { baselineRows, constraintsRows, performanceRows, totalBudget };
}

async function writeCsvCanonicalFiles(
  repoRoot: string,
  clientId: string,
  payload: ReturnType<typeof buildCanonicalFromCsv>,
): Promise<void> {
  const dataDir = path.join(repoRoot, "data", "canonical");
  await fs.mkdir(dataDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(dataDir, `${clientId}_channel_baseline.csv`),
      csvStringify(payload.baselineRows),
      "utf8",
    ),
    fs.writeFile(
      path.join(dataDir, `${clientId}_constraints.csv`),
      csvStringify(payload.constraintsRows),
      "utf8",
    ),
    fs.writeFile(
      path.join(dataDir, `${clientId}_performance.csv`),
      csvStringify(payload.performanceRows),
      "utf8",
    ),
  ]);
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");
  const clientLabel = String(formData.get("clientLabel") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (![".xlsx", ".csv"].includes(ext)) {
    return NextResponse.json({ error: "Only .xlsx and .csv uploads are supported." }, { status: 400 });
  }

  const repoRoot = path.resolve(process.cwd(), "..");
  const uploadsDir = path.join(repoRoot, "data", "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });

  const base = slugify(clientLabel || path.basename(file.name, ext) || "uploaded_client");
  const clientId = `${base}_${Date.now().toString().slice(-6)}`;
  const tempPath = path.join(uploadsDir, `${clientId}${ext}`);
  await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

  try {
    let totalBudget = 0;

    if (ext === ".xlsx") {
      await runPythonScript(repoRoot, "scripts/ingest_excel.py", [
        "--workbook",
        tempPath,
        "--client",
        clientId,
        "--output-dir",
        "data/canonical",
      ]);

      const metadataPath = path.join(repoRoot, "data", "canonical", `${clientId}_ingestion_metadata.json`);
      const metadataRaw = await fs.readFile(metadataPath, "utf8");
      const metadata = JSON.parse(metadataRaw) as { modeled_total_budget?: number };
      totalBudget = Number(metadata.modeled_total_budget ?? 0);
    } else {
      const csvRaw = await fs.readFile(tempPath, "utf8");
      const parsed = parseCsv(csvRaw);
      const canonical = buildCanonicalFromCsv(parsed, clientId);
      if (!canonical.baselineRows.length) {
        return NextResponse.json(
          {
            error:
              "CSV must include at least `channel` and one spend column (`baseline_spend`, `recommended_spend`, or `spend`).",
          },
          { status: 400 },
        );
      }
      totalBudget = canonical.totalBudget;
      await writeCsvCanonicalFiles(repoRoot, clientId, canonical);
    }

    const effectiveBudget = totalBudget > 0 ? totalBudget : 100000;
    await ensureClientConfig(repoRoot, clientId, effectiveBudget);

    for (const objective of OBJECTIVES) {
      await runPythonScript(repoRoot, "scripts/run_optimizer.py", [
        "--client",
        clientId,
        "--objective",
        objective,
        "--output-dir",
        "data/canonical/outputs",
      ]);
    }

    const snapshot = await loadRoiSnapshot();
    return NextResponse.json(
      {
        success: true,
        clientId,
        source: "live",
        snapshot,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const fallback = await loadRoiSnapshot();
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Optimizer run failed.",
        source: "demo",
        snapshot: fallback,
      },
      { status: 500 },
    );
  }
}
