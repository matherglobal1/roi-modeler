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

type MonthlyPoint = {
  month: string;
  totalSpend: number;
  totalPipeline: number;
  totalRevenue: number;
};

type RawEntry = {
  month: string;
  periodStart: string;
  channel: string;
  spend: number;
  pipeline: number;
  revenue: number;
};

type CanonicalPayload = {
  baselineRows: Array<Record<string, string | number>>;
  constraintsRows: Array<Record<string, string | number | boolean>>;
  performanceRows: Array<Record<string, string | number>>;
  totalBudget: number;
  displayName: string;
  monthlyTrend: MonthlyPoint[];
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

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function parseMonthToPeriodStart(value: string, rowNumber: number): string {
  const text = value.trim();
  if (!text) {
    throw new Error(`Time Period (Month) is required on row ${rowNumber}.`);
  }
  const ymMatch = text.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    const month = Number(ymMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${ymMatch[1]}-${ymMatch[2]}-01`;
    }
  }

  const parsed = new Date(`${text} 1`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Time Period (Month) must look like 'January 2026' or '2026-01' on row ${rowNumber}.`,
    );
  }
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-01`;
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

  const entries: RawEntry[] = [];
  let displayName = "";

  upload.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const clientName = getValue(row, "Client Name");
    const periodRaw = getValue(row, "Time Period (Month)");
    const channel = getValue(row, "Channel");
    const budgetRaw = getValue(row, "Budget");
    const pipelineRaw = getValue(row, "Expected Pipeline");
    const revenueRaw = getValue(row, "Expected Revenue");

    const allBlank = [clientName, periodRaw, channel, budgetRaw, pipelineRaw, revenueRaw].every(
      (value) => value.length === 0,
    );
    if (allBlank) {
      return;
    }

    if (!clientName || !periodRaw || !channel || !budgetRaw || !pipelineRaw || !revenueRaw) {
      throw new Error(`All required fields must be filled on row ${rowNumber}.`);
    }

    if (!displayName) {
      displayName = clientName;
    }

    const periodStart = parseMonthToPeriodStart(periodRaw, rowNumber);
    const spend = toNumber(budgetRaw, "Budget", rowNumber);
    const pipeline = toNumber(pipelineRaw, "Expected Pipeline", rowNumber);
    const revenue = toNumber(revenueRaw, "Expected Revenue", rowNumber);

    if (spend <= 0) {
      throw new Error(`Budget must be greater than zero on row ${rowNumber}.`);
    }

    entries.push({
      month: periodStart.slice(0, 7),
      periodStart,
      channel,
      spend,
      pipeline,
      revenue,
    });
  });

  if (!entries.length) {
    throw new Error("No channel rows found. Add at least one channel-month row to the template.");
  }

  const totalBudget = entries.reduce((sum, entry) => sum + entry.spend, 0);
  const byChannel = new Map<
    string,
    { spend: number; pipeline: number; revenue: number }
  >();

  entries.forEach((entry) => {
    const current = byChannel.get(entry.channel) ?? { spend: 0, pipeline: 0, revenue: 0 };
    current.spend += entry.spend;
    current.pipeline += entry.pipeline;
    current.revenue += entry.revenue;
    byChannel.set(entry.channel, current);
  });

  const byMonth = new Map<string, MonthlyPoint>();
  entries.forEach((entry) => {
    const point = byMonth.get(entry.month) ?? {
      month: entry.month,
      totalSpend: 0,
      totalPipeline: 0,
      totalRevenue: 0,
    };
    point.totalSpend += entry.spend;
    point.totalPipeline += entry.pipeline;
    point.totalRevenue += entry.revenue;
    byMonth.set(entry.month, point);
  });

  const monthlyTrend = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

  const baselineRows = Array.from(byChannel.entries()).map(([channel, totals]) => {
    const beta = 0.72;
    const hqls = Math.max(1, totals.revenue / 200);
    const leads = hqls * 2.4;
    const opps = hqls * 0.18;
    const alphaPipeline = totals.pipeline / totals.spend ** beta;
    const alphaRevenue = totals.revenue / totals.spend ** beta;
    const alphaHql = hqls / totals.spend ** beta;
    const alphaLeads = leads / totals.spend ** beta;

    return {
      client_id: clientId,
      channel,
      baseline_spend: Number(totals.spend.toFixed(2)),
      baseline_share: Number((totals.spend / totalBudget).toFixed(6)),
      engaged_leads: Number(leads.toFixed(2)),
      hqls: Number(hqls.toFixed(2)),
      opps_sourced: Number(opps.toFixed(2)),
      pipeline_sourced: Number(totals.pipeline.toFixed(2)),
      cw_acv_sourced: Number(totals.revenue.toFixed(2)),
      roas_baseline: Number((totals.revenue / totals.spend).toFixed(4)),
      cac_baseline: Number((totals.spend / Math.max(1, hqls)).toFixed(4)),
      beta,
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

  const now = new Date().toISOString();
  const performanceRows = entries.map((entry) => {
    const dt = new Date(entry.periodStart);
    const quarter = Math.floor(dt.getMonth() / 3) + 1;
    const hqls = Math.max(1, entry.revenue / 200);
    const leads = hqls * 2.4;
    const opps = hqls * 0.18;

    return {
      client_id: clientId,
      geo: "Global",
      channel: entry.channel,
      sub_channel: entry.channel,
      platform: "Template Upload",
      fiscal_year: dt.getFullYear(),
      fiscal_quarter: `Q${quarter}`,
      quarter_label: `Q${quarter}`,
      period_start: entry.periodStart,
      engaged_leads: Number(leads.toFixed(2)),
      hqls: Number(hqls.toFixed(2)),
      opps_sourced: Number(opps.toFixed(2)),
      pipeline_sourced: Number(entry.pipeline.toFixed(2)),
      pipeline_influenced: Number(entry.pipeline.toFixed(2)),
      cw_opps_sourced: Number(opps.toFixed(2)),
      cw_acv_sourced: Number(entry.revenue.toFixed(2)),
      cw_acv_influenced: Number(entry.revenue.toFixed(2)),
      hql_to_opp_conversion: Number((opps / Math.max(1, hqls)).toFixed(4)),
      source_file: "upload_template",
      ingested_at: now,
    };
  });

  return {
    baselineRows,
    constraintsRows,
    performanceRows,
    totalBudget,
    displayName: displayName || clientId.replaceAll("_", " "),
    monthlyTrend,
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

async function writeClientProfile(
  repoRoot: string,
  clientId: string,
  displayName: string,
  monthlyTrend: MonthlyPoint[],
): Promise<void> {
  const profilePath = path.join(repoRoot, "data", "canonical", `${clientId}_profile.json`);
  const payload = {
    client_id: clientId,
    display_name: displayName,
    monthly_trend: monthlyTrend,
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
    await writeClientProfile(repoRoot, clientId, displayName, canonical.monthlyTrend);

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
