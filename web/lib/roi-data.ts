import { promises as fs } from "node:fs";
import path from "node:path";

export type ObjectiveSlug = "pipeline" | "revenue" | "roas" | "cac";

export type RoiSummary = {
  generated_at: string;
  client_id: string;
  objective: ObjectiveSlug | string;
  total_budget: number;
  total_pipeline: number;
  total_revenue: number;
  total_hqls: number;
  overall_roas: number;
  overall_cac: number;
  guardrail_status: string;
  unallocated_budget: number;
  [key: string]: string | number | boolean | null | undefined;
};

export type RoiChannelRecommendation = {
  client_id: string;
  channel: string;
  recommended_spend: number;
  recommended_share: number;
  pred_pipeline: number;
  pred_revenue: number;
  pred_hqls: number;
  pred_leads: number;
  pred_roas: number;
  pred_cac: number;
  min_spend: number;
  max_spend: number;
  [key: string]: string | number | boolean | null | undefined;
};

export type RoiScenario = {
  id: string;
  objective: string;
  timestamp: string;
  summaryFile: string;
  recommendationFile: string;
  summary: RoiSummary;
  recommendations: RoiChannelRecommendation[];
};

export type RoiMonthlyPoint = {
  month: string;
  totalSpend: number;
  totalPipeline: number;
  totalRevenue: number;
};

export type RoiClientData = {
  clientId: string;
  displayName?: string;
  monthlyTrend?: RoiMonthlyPoint[];
  scenarios: RoiScenario[];
};

export type RoiSnapshot = {
  generatedAt: string;
  source: "optimizer_outputs" | "live" | "demo";
  clients: RoiClientData[];
};

type ParsedFileName = {
  clientId: string;
  objective: string;
  kind: "summary" | "recommendation";
  timestamp: string;
};

type ClientProfile = {
  client_id?: string;
  display_name?: string;
  monthly_trend?: RoiMonthlyPoint[];
};

const ROAS_CALIBRATION_FACTOR = 0.5;

const OUTPUT_FILE_RE =
  /^([a-z0-9_]+?)(?:_(pipeline|revenue|roas|cac))?_(summary|recommendation)_(\d{8}_\d{6})\.(json|csv)$/i;

function parseOutputFileName(fileName: string): ParsedFileName | null {
  const match = fileName.match(OUTPUT_FILE_RE);
  if (!match) {
    return null;
  }
  const [, clientId, objective, kind, timestamp] = match;
  return {
    clientId: clientId.toLowerCase(),
    objective: (objective ?? "pipeline").toLowerCase(),
    kind: kind.toLowerCase() as "summary" | "recommendation",
    timestamp,
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function coerceValue(raw: string): string | number | boolean | null {
  if (raw === "") {
    return null;
  }
  const lower = raw.toLowerCase();
  if (lower === "true") {
    return true;
  }
  if (lower === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function parseCsvToObjects(csvText: string): Record<string, string | number | boolean | null>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string | number | boolean | null> = {};
    headers.forEach((header, idx) => {
      row[header] = coerceValue(cells[idx] ?? "");
    });
    return row;
  });
}

async function readDemoSnapshot(): Promise<RoiSnapshot> {
  const demoPath = path.resolve(process.cwd(), "data", "demo-snapshot.json");
  const raw = await fs.readFile(demoPath, "utf8");
  const parsed = JSON.parse(raw) as RoiSnapshot;
  return applyRoasCalibration(parsed);
}

function prettifyClientId(clientId: string): string {
  return clientId
    .replace(/_\d{6,}$/g, "")
    .replaceAll("_", " ")
    .trim();
}

function applyRoasCalibration(snapshot: RoiSnapshot): RoiSnapshot {
  return {
    ...snapshot,
    clients: snapshot.clients.map((client) => ({
      ...client,
      scenarios: client.scenarios.map((scenario) => ({
        ...scenario,
        summary: {
          ...scenario.summary,
          overall_roas: Number(
            (Number(scenario.summary.overall_roas ?? 0) * ROAS_CALIBRATION_FACTOR).toFixed(4),
          ),
        },
        recommendations: scenario.recommendations.map((row) => ({
          ...row,
          pred_roas: Number((Number(row.pred_roas ?? 0) * ROAS_CALIBRATION_FACTOR).toFixed(4)),
        })),
      })),
    })),
  };
}

async function readClientProfile(outputDir: string, clientId: string): Promise<ClientProfile | null> {
  const profilePath = path.join(outputDir, "..", `${clientId}_profile.json`);
  try {
    const raw = await fs.readFile(profilePath, "utf8");
    return JSON.parse(raw) as ClientProfile;
  } catch {
    return null;
  }
}

export async function loadRoiSnapshot(): Promise<RoiSnapshot> {
  const outputDir = path.resolve(process.cwd(), "..", "data", "canonical", "outputs");

  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .map((name) => ({ name, parsed: parseOutputFileName(name) }))
      .filter((item): item is { name: string; parsed: ParsedFileName } => Boolean(item.parsed));

    if (files.length === 0) {
      return await readDemoSnapshot();
    }

    const scenarioFiles = new Map<
      string,
      {
        clientId: string;
        objective: string;
        timestamp: string;
        summary?: { fileName: string; timestamp: string };
        recommendation?: { fileName: string; timestamp: string };
      }
    >();

    for (const file of files) {
      const parsed = file.parsed;
      const key = `${parsed.clientId}|${parsed.objective}|${parsed.timestamp}`;
      const existing = scenarioFiles.get(key) ?? {
        clientId: parsed.clientId,
        objective: parsed.objective,
        timestamp: parsed.timestamp,
      };
      const current = existing[parsed.kind];
      if (!current) {
        existing[parsed.kind] = { fileName: file.name, timestamp: parsed.timestamp };
      }
      scenarioFiles.set(key, existing);
    }

    const clientsMap = new Map<string, RoiScenario[]>();
    for (const [, value] of scenarioFiles.entries()) {
      if (!value.summary || !value.recommendation) {
        continue;
      }
      const [summaryRaw, recommendationRaw] = await Promise.all([
        fs.readFile(path.join(outputDir, value.summary.fileName), "utf8"),
        fs.readFile(path.join(outputDir, value.recommendation.fileName), "utf8"),
      ]);

      const summary = JSON.parse(summaryRaw) as RoiSummary;
      const recommendations = parseCsvToObjects(recommendationRaw) as RoiChannelRecommendation[];
      const scenarios = clientsMap.get(value.clientId) ?? [];
      scenarios.push({
        id: `${value.objective}__${value.timestamp}`,
        objective: value.objective,
        timestamp: value.summary.timestamp,
        summaryFile: value.summary.fileName,
        recommendationFile: value.recommendation.fileName,
        summary,
        recommendations,
      });
      clientsMap.set(value.clientId, scenarios);
    }

    const clients = await Promise.all(
      Array.from(clientsMap.entries()).map(async ([clientId, scenarios]) => {
        const profile = await readClientProfile(outputDir, clientId);
        return {
          clientId,
          displayName: profile?.display_name || prettifyClientId(clientId),
          monthlyTrend: profile?.monthly_trend || [],
          scenarios: scenarios.sort((a, b) => {
          if (a.timestamp === b.timestamp) {
            return a.objective.localeCompare(b.objective);
          }
          return b.timestamp.localeCompare(a.timestamp);
          }),
        };
      }),
    );
    const sortedClients = clients
      .sort((a, b) => a.clientId.localeCompare(b.clientId));

    if (sortedClients.length === 0) {
      return await readDemoSnapshot();
    }

    return applyRoasCalibration({
      generatedAt: new Date().toISOString(),
      source: "optimizer_outputs",
      clients: sortedClients,
    });
  } catch {
    return await readDemoSnapshot();
  }
}
