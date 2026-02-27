import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { loadRoiSnapshot } from "@/lib/roi-data";
import { REQUIRED_TEMPLATE_HEADERS } from "@/lib/upload-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const OBJECTIVES = ["pipeline", "revenue", "roas", "cac"];

type TabularUpload = {
  headers: string[];
  rows: string[][];
};

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

function normalizeHeader(text: string): string {
  return text.trim();
}

async function readTabularUpload(filePath: string, ext: string): Promise<TabularUpload> {
  if (ext === ".csv") {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return { headers: [], rows: [] };
    }
    return {
      headers: parseCsvLine(lines[0]).map(normalizeHeader),
      rows: lines.slice(1).map((line) => parseCsvLine(line)),
    };
  }

  const workbook = XLSX.readFile(filePath);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(firstSheet, {
    header: 1,
    blankrows: false,
  });
  if (!rows.length) {
    return { headers: [], rows: [] };
  }
  const headers = (rows[0] ?? []).map((value) => normalizeHeader(String(value ?? "")));
  const values = rows.slice(1).map((row) => headers.map((_, index) => String(row[index] ?? "")));
  return { headers, rows: values };
}

function toNumber(raw: string, fieldName: string, rowNumber: number): number {
  const cleaned = raw.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be numeric on row ${rowNumber}.`);
  }
  return parsed;
}

type CanonicalPayload = {
  baselineRows: Array<Record<string, string | number>>;
  constraintsRows: Array<Record<string, string | number | boolean>>;
  performanceRows: Array<Record<string, string | number>>;
  totalBudget: number;
  displayName: string;
};

function buildCanonicalFromTemplate(upload: TabularUpload, clientId: string): CanonicalPayload {
  const headerIndex = new Map<string, number>();
  upload.headers.forEach((header, idx) => {
    headerIndex.set(normalizeHeader(header), idx);
  });

  const missingHeaders = REQUIRED_TEMPLATE_HEADERS.filter(
    (required) => !headerIndex.has(normalizeHeader(required)),
  );
  if (missingHeaders.length > 0) {
    throw new Error(
      `Missing column: ${missingHeaders[0]}. Download the template to see the required format.`,
    );
  }

  const getValue = (row: string[], header: string): string => {
    const idx = headerIndex.get(normalizeHeader(header));
    return idx === undefined ? "" : String(row[idx] ?? "").trim();
  };

  const entries: Array<{
    channel: string;
    spend: number;
    pipeline: number;
    revenue: number;
    hqls: number;
    leads: number;
    beta: number;
  }> = [];
  let displayName = "";

  upload.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const clientName = getValue(row, "Client Name");
    const channel = getValue(row, "Channel");
    const spendRaw = getValue(row, "Monthly Budget");
    const pipelineRaw = getValue(row, "Projected Pipeline");
    const revenueRaw = getValue(row, "Projected Revenue");
    const hqlRaw = getValue(row, "Projected HQLs");
    const leadsRaw = getValue(row, "Projected Leads");
    const betaRaw = getValue(row, "Diminishing Returns Beta (Optional)");

    const allBlank = [clientName, channel, spendRaw, pipelineRaw, revenueRaw, hqlRaw, leadsRaw].every(
      (value) => value.length === 0,
    );
    if (allBlank) {
      return;
    }

    if (!clientName || !channel || !spendRaw || !pipelineRaw || !revenueRaw || !hqlRaw || !leadsRaw) {
      throw new Error(`All required fields must be filled on row ${rowNumber}.`);
    }

    if (!displayName) {
      displayName = clientName;
    }

    const spend = toNumber(spendRaw, "Monthly Budget", rowNumber);
    const pipeline = toNumber(pipelineRaw, "Projected Pipeline", rowNumber);
    const revenue = toNumber(revenueRaw, "Projected Revenue", rowNumber);
    const hqls = toNumber(hqlRaw, "Projected HQLs", rowNumber);
    const leads = toNumber(leadsRaw, "Projected Leads", rowNumber);
    const beta = betaRaw ? toNumber(betaRaw, "Diminishing Returns Beta (Optional)", rowNumber) : 0.72;

    if (spend <= 0) {
      throw new Error(`Monthly Budget must be greater than zero on row ${rowNumber}.`);
    }

    entries.push({
      channel,
      spend,
      pipeline,
      revenue,
      hqls,
      leads,
      beta,
    });
  });

  if (!entries.length) {
    throw new Error("No channel rows found. Add at least one channel row to the template.");
  }

  const totalBudget = entries.reduce((sum, item) => sum + item.spend, 0);
  const now = new Date().toISOString();

  const baselineRows = entries.map((item) => {
    const alphaPipeline = item.pipeline / item.spend ** item.beta;
    const alphaRevenue = item.revenue / item.spend ** item.beta;
    const alphaHql = item.hqls / item.spend ** item.beta;
    const alphaLeads = item.leads / item.spend ** item.beta;
    return {
      client_id: clientId,
      channel: item.channel,
      baseline_spend: Number(item.spend.toFixed(2)),
      baseline_share: Number((item.spend / totalBudget).toFixed(6)),
      engaged_leads: Number(item.leads.toFixed(2)),
      hqls: Number(item.hqls.toFixed(2)),
      opps_sourced: Number((item.hqls * 0.18).toFixed(2)),
      pipeline_sourced: Number(item.pipeline.toFixed(2)),
      cw_acv_sourced: Number(item.revenue.toFixed(2)),
      roas_baseline: Number((item.revenue / item.spend).toFixed(4)),
      cac_baseline: Number((item.spend / Math.max(1, item.hqls)).toFixed(4)),
      beta: Number(item.beta.toFixed(4)),
      alpha_pipeline: Number(alphaPipeline.toFixed(6)),
      alpha_revenue: Number(alphaRevenue.toFixed(6)),
      alpha_hqls: Number(alphaHql.toFixed(6)),
      alpha_leads: Number(alphaLeads.toFixed(6)),
      notes: "Generated from upload template.",
    };
  });

  const constraintsRows = baselineRows.map((row) => {
    const minSpend = Number((Number(row.baseline_spend) * 0.4).toFixed(2));
    const rawMax = Math.max(Number(row.baseline_spend) * 1.8, totalBudget * 0.1);
    const maxSpend = Number(Math.min(rawMax, totalBudget * 0.75).toFixed(2));
    return {
      client_id: clientId,
      channel: row.channel,
      enabled: true,
      min_spend: minSpend,
      max_spend: maxSpend,
      locked_spend: "",
      min_share: Number((minSpend / totalBudget).toFixed(6)),
      max_share: Number((maxSpend / totalBudget).toFixed(6)),
      min_roas: Number((Number(row.roas_baseline) * 0.7).toFixed(4)),
      max_cac: Number((Number(row.cac_baseline) * 1.4).toFixed(4)),
      notes: "Auto-generated hard caps.",
    };
  });

  const performanceRows = baselineRows.map((row) => ({
    client_id: clientId,
    geo: "Global",
    channel: row.channel,
    sub_channel: row.channel,
    platform: "Template Upload",
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
    hql_to_opp_conversion:
      Number(row.hqls) > 0 ? Number((Number(row.opps_sourced) / Number(row.hqls)).toFixed(4)) : 0,
    source_file: "upload_template",
    ingested_at: now,
  }));

  return {
    baselineRows,
    constraintsRows,
    performanceRows,
    totalBudget,
    displayName: displayName || clientId.replaceAll("_", " "),
  };
}

function csvStringify(rows: Array<Record<string, string | number | boolean>>): string {
  if (!rows.length) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

async function writeCanonicalFiles(repoRoot: string, clientId: string, payload: CanonicalPayload): Promise<void> {
  const dataDir = path.join(repoRoot, "data", "canonical");
  await fs.mkdir(dataDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dataDir, `${clientId}_channel_baseline.csv`), csvStringify(payload.baselineRows), "utf8"),
    fs.writeFile(path.join(dataDir, `${clientId}_constraints.csv`), csvStringify(payload.constraintsRows), "utf8"),
    fs.writeFile(path.join(dataDir, `${clientId}_performance.csv`), csvStringify(payload.performanceRows), "utf8"),
  ]);
}

async function ensureClientConfig(repoRoot: string, clientId: string, totalBudget: number): Promise<void> {
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

async function writeClientProfile(repoRoot: string, clientId: string, displayName: string): Promise<void> {
  const profilePath = path.join(repoRoot, "data", "canonical", `${clientId}_profile.json`);
  const payload = {
    client_id: clientId,
    display_name: displayName,
    updated_at: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.writeFile(profilePath, JSON.stringify(payload, null, 2), "utf8");
}

async function runPythonScript(repoRoot: string, args: string[]): Promise<void> {
  const attempts: Array<{ command: string; commandArgs: string[] }> = [
    { command: process.env.PYTHON_BIN || "python", commandArgs: ["scripts/run_optimizer.py", ...args] },
  ];
  if (process.platform === "win32") {
    attempts.push({ command: "py", commandArgs: ["-3", "scripts/run_optimizer.py", ...args] });
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await execFileAsync(attempt.command, attempt.commandArgs, {
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
    const uploadData = await readTabularUpload(tempPath, ext);
    const canonical = buildCanonicalFromTemplate(uploadData, clientId);
    const displayName = clientLabel.trim() || canonical.displayName;

    await writeCanonicalFiles(repoRoot, clientId, canonical);
    await ensureClientConfig(repoRoot, clientId, canonical.totalBudget || 100000);
    await writeClientProfile(repoRoot, clientId, displayName);

    for (const objective of OBJECTIVES) {
      await runPythonScript(repoRoot, [
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
        displayName,
        source: "live",
        snapshot,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Optimizer run failed.";
    const status = message.startsWith("Missing column:") ? 400 : 500;
    const fallback = await loadRoiSnapshot();
    return NextResponse.json(
      {
        success: false,
        error: message,
        source: "demo",
        snapshot: fallback,
      },
      { status },
    );
  }
}
