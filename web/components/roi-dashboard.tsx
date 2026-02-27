"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import type {
  RoiChannelRecommendation,
  RoiMonthlyPoint,
  RoiSnapshot,
} from "@/lib/roi-data";
import styles from "@/app/page.module.css";

type ViewMode = "aggregate" | "monthly";

const OBJECTIVE_LABELS: Record<string, string> = {
  pipeline: "Pipeline",
  revenue: "Revenue",
  roas: "ROAS",
  cac: "CAC",
};

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatMetric(value: number, asMoney = false): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return asMoney ? moneyFormatter.format(value) : compactFormatter.format(value);
}

function formatTimestamp(timestamp: string): string {
  const normalized = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatObjective(objective: string): string {
  return OBJECTIVE_LABELS[objective] ?? objective.toUpperCase();
}

function sourceLabel(source: RoiSnapshot["source"]): string {
  if (source === "demo") {
    return "Demo Data";
  }
  if (source === "live") {
    return "Live Model Output";
  }
  return "Optimizer Output";
}

function formatClientName(clientId: string, displayName?: string): string {
  if (displayName && displayName.trim().length > 0) {
    return displayName;
  }
  return clientId.replace(/_\d{6,}$/g, "").replaceAll("_", " ").trim();
}

function formatMonthLabel(month: string): string {
  const parsed = new Date(`${month}-01`);
  if (Number.isNaN(parsed.getTime())) {
    return month;
  }
  return parsed.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function linePath(values: number[], width: number, height: number, padding: number): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return `M ${padding} ${height - padding} L ${width - padding} ${height - padding}`;
  }
  const max = Math.max(...values, 1);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  return values
    .map((value, index) => {
      const x = padding + (innerWidth * index) / (values.length - 1);
      const y = height - padding - (value / max) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function barWidth(value: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.max(0, Math.min(100, (value / total) * 100)).toFixed(1)}%`;
}

type DashboardProps = {
  snapshot: RoiSnapshot;
  initialClientId?: string;
  initialScenarioId?: string;
};

export default function RoiDashboard({
  snapshot,
  initialClientId,
  initialScenarioId,
}: DashboardProps) {
  const clients = snapshot.clients;
  const defaultClient = clients.find((client) => client.clientId === initialClientId) ?? clients[0];

  const [clientId, setClientId] = useState(defaultClient?.clientId ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>("aggregate");

  const selectedClient = useMemo(() => {
    return clients.find((client) => client.clientId === clientId) ?? clients[0];
  }, [clientId, clients]);

  const scenarioOptions = useMemo(() => selectedClient?.scenarios ?? [], [selectedClient]);
  const [scenarioId, setScenarioId] = useState(
    scenarioOptions.find((item) => item.id === initialScenarioId)?.id ?? scenarioOptions[0]?.id ?? "",
  );

  const scenario = useMemo(() => {
    return scenarioOptions.find((item) => item.id === scenarioId) ?? scenarioOptions[0];
  }, [scenarioId, scenarioOptions]);

  const channels = useMemo(() => {
    return [...(scenario?.recommendations ?? [])].sort(
      (a, b) => toNumber(b.recommended_spend) - toNumber(a.recommended_spend),
    );
  }, [scenario]);

  const topSevenChannels = useMemo(() => channels.slice(0, 7), [channels]);
  const monthlyTrend = useMemo<RoiMonthlyPoint[]>(
    () =>
      [...(selectedClient?.monthlyTrend ?? [])].sort((a, b) =>
        a.month.localeCompare(b.month),
      ),
    [selectedClient],
  );

  const spendSeries = monthlyTrend.map((point) => toNumber(point.totalSpend));
  const pipelineSeries = monthlyTrend.map((point) => toNumber(point.totalPipeline));
  const spendPath = linePath(spendSeries, 760, 250, 28);
  const pipelinePath = linePath(pipelineSeries, 760, 250, 28);

  const totalSpend = toNumber(scenario?.summary.total_budget);
  const guardrailStatus = `${scenario?.summary.guardrail_status ?? "unknown"}`.toLowerCase();
  const reportDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  function handleClientSelect(nextClientId: string) {
    setClientId(nextClientId);
    const nextClient = clients.find((item) => item.clientId === nextClientId);
    setScenarioId(nextClient?.scenarios[0]?.id ?? "");
  }

  function handleExportPdf() {
    window.print();
  }

  if (!scenario || !selectedClient) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyState}>
          <h1>No optimizer outputs found</h1>
          <p>Run `python scripts/run_optimizer.py --client autodesk --objective pipeline` and refresh.</p>
        </section>
      </main>
    );
  }

  const preparedFor = formatClientName(selectedClient.clientId, selectedClient.displayName);

  return (
    <main className={styles.page}>
      <div className={styles.screenOnly}>
        <section className={styles.heroSection}>
          <div>
            <p className={styles.kicker}>ROI Modeller</p>
            <h1 className={styles.commandTitle}>Command Center</h1>
            <p className={styles.preparedFor}>
              Prepared for: <strong>{preparedFor}</strong>
            </p>
            <p className={styles.heroSubtitle}>
              Strategic budget recommendations across channels, built for executive review and weekly decision velocity.
            </p>
          </div>
          <div className={styles.heroMeta}>
            <button type="button" className={styles.exportButton} onClick={handleExportPdf}>
              Export to PDF
            </button>
            <span className={styles.sourcePill}>{sourceLabel(snapshot.source)}</span>
            <span>{formatObjective(scenario.objective)} objective</span>
          </div>
        </section>

        <section className={styles.controlsSection}>
          <label className={styles.controlField}>
            <span>Client</span>
            <select value={selectedClient.clientId} onChange={(event) => handleClientSelect(event.target.value)}>
              {clients.map((client) => (
                <option key={client.clientId} value={client.clientId}>
                  {formatClientName(client.clientId, client.displayName)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.controlField}>
            <span>Scenario</span>
            <select value={scenario.id} onChange={(event) => setScenarioId(event.target.value)}>
              {scenarioOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatObjective(item.objective)} - {formatTimestamp(item.timestamp)}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.healthField}>
            <span>Guardrails</span>
            <strong className={guardrailStatus === "pass" ? styles.pass : styles.warn}>
              {guardrailStatus.toUpperCase()}
            </strong>
          </div>
        </section>

        <section className={styles.viewToggleSection}>
          <span>View:</span>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={viewMode === "aggregate" ? styles.viewToggleActive : ""}
              onClick={() => setViewMode("aggregate")}
            >
              Aggregate
            </button>
            <button
              type="button"
              className={viewMode === "monthly" ? styles.viewToggleActive : ""}
              onClick={() => setViewMode("monthly")}
            >
              Monthly
            </button>
          </div>
        </section>

        <section className={styles.metricSection}>
          {[
            { label: "Total Budget", value: formatMetric(totalSpend, true) },
            { label: "Total Pipeline", value: formatMetric(toNumber(scenario.summary.total_pipeline), true) },
            { label: "Total Revenue", value: formatMetric(toNumber(scenario.summary.total_revenue), true) },
            { label: "Overall ROAS", value: `${toNumber(scenario.summary.overall_roas).toFixed(2)}x` },
            { label: "Overall CAC", value: moneyFormatter.format(toNumber(scenario.summary.overall_cac)) },
          ].map((metric, index) => (
            <article
              key={metric.label}
              className={styles.metricCard}
              style={{ "--delay": `${index * 60}ms` } as CSSProperties}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </section>

        {viewMode === "aggregate" ? (
          <section className={styles.compactAllocationSection}>
            <header className={styles.panelHeader}>
              <h2>Spend Allocation</h2>
              <p>Compact channel mix for this scenario.</p>
            </header>
            <div className={styles.compactRows}>
              {topSevenChannels.map((channel) => {
                const spend = toNumber(channel.recommended_spend);
                return (
                  <div key={channel.channel} className={styles.compactRow}>
                    <strong>{channel.channel}</strong>
                    <span>{moneyFormatter.format(spend)}</span>
                    <span>{percentFormatter.format(toNumber(channel.recommended_share))}</span>
                    <span>{toNumber(channel.pred_roas).toFixed(2)}x</span>
                    <div className={styles.compactBarTrack}>
                      <div
                        className={styles.compactBarFill}
                        style={{ width: barWidth(spend, totalSpend) }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section className={styles.monthlySection}>
            <header className={styles.panelHeader}>
              <h2>Monthly Trends</h2>
              <p>Spend and pipeline by month from uploaded data.</p>
            </header>
            {monthlyTrend.length > 0 ? (
              <>
                <div className={styles.trendLegend}>
                  <span><i className={styles.spendDot} /> Spend</span>
                  <span><i className={styles.pipelineDot} /> Pipeline</span>
                </div>
                <svg className={styles.trendChart} viewBox="0 0 760 250" role="img" aria-label="Monthly spend and pipeline trend">
                  <rect x="0" y="0" width="760" height="250" fill="#ffffff" />
                  {[0, 1, 2, 3].map((tick) => (
                    <line
                      key={tick}
                      x1="28"
                      x2="732"
                      y1={28 + tick * 64}
                      y2={28 + tick * 64}
                      stroke="#e2e8f0"
                    />
                  ))}
                  <path d={spendPath} fill="none" stroke="#0ea5e9" strokeWidth="3" />
                  <path d={pipelinePath} fill="none" stroke="#14b8a6" strokeWidth="3" />
                </svg>
                <div className={styles.monthLabels}>
                  {monthlyTrend.map((point) => (
                    <span key={point.month}>{formatMonthLabel(point.month)}</span>
                  ))}
                </div>
                <div className={styles.monthlyTableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Total Spend</th>
                        <th>Total Pipeline</th>
                        <th>Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyTrend.map((point) => (
                        <tr key={point.month}>
                          <td>{formatMonthLabel(point.month)}</td>
                          <td>{moneyFormatter.format(toNumber(point.totalSpend))}</td>
                          <td>{moneyFormatter.format(toNumber(point.totalPipeline))}</td>
                          <td>{moneyFormatter.format(toNumber(point.totalRevenue))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className={styles.emptyHint}>
                Monthly trend data appears when upload rows include the Time Period (Month) column.
              </p>
            )}
          </section>
        )}

        <section className={styles.tableSection}>
          <header className={styles.panelHeader}>
            <h2>Channel Detail</h2>
            <p>Predicted outcomes and channel-level economics</p>
          </header>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Spend</th>
                  <th>Share</th>
                  <th>Pipeline</th>
                  <th>Revenue</th>
                  <th>ROAS</th>
                  <th>CAC</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((row: RoiChannelRecommendation) => (
                  <tr key={row.channel}>
                    <td>{row.channel}</td>
                    <td>{moneyFormatter.format(toNumber(row.recommended_spend))}</td>
                    <td>{percentFormatter.format(toNumber(row.recommended_share))}</td>
                    <td>{formatMetric(toNumber(row.pred_pipeline), true)}</td>
                    <td>{formatMetric(toNumber(row.pred_revenue), true)}</td>
                    <td>{toNumber(row.pred_roas).toFixed(2)}x</td>
                    <td>{moneyFormatter.format(toNumber(row.pred_cac))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className={styles.footerNote}>Powered by Just Global Strategy Team</footer>
      </div>

      <section className={styles.printReport}>
        <article className={styles.printPage}>
          <div className={styles.printTitleTop}>
            <Image src="/just-global-logo.png" alt="Just Global" width={320} height={36} />
            <p>{reportDate}</p>
          </div>
          <div className={styles.printTitleBody}>
            <h1>Budget Optimization Report</h1>
            <h2>{preparedFor}</h2>
            <p>Prepared by Just Global Strategy Team</p>
          </div>
          <footer className={styles.printFooter}>Confidential - Prepared by Just Global | Page 1 of 4</footer>
        </article>

        <article className={styles.printPage}>
          <h2 className={styles.printPageHeading}>KPI Summary</h2>
          <div className={styles.printKpiGrid}>
            {[
              { label: "Total Budget", value: formatMetric(totalSpend, true) },
              { label: "Pipeline", value: formatMetric(toNumber(scenario.summary.total_pipeline), true) },
              { label: "Revenue", value: formatMetric(toNumber(scenario.summary.total_revenue), true) },
              { label: "ROAS", value: `${toNumber(scenario.summary.overall_roas).toFixed(2)}x` },
              { label: "CAC", value: moneyFormatter.format(toNumber(scenario.summary.overall_cac)) },
            ].map((item) => (
              <div key={item.label} className={styles.printKpiCard}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <footer className={styles.printFooter}>Confidential - Prepared by Just Global | Page 2 of 4</footer>
        </article>

        <article className={styles.printPage}>
          <h2 className={styles.printPageHeading}>Spend Allocation (Top 7 Channels)</h2>
          <div className={styles.printAllocationTable}>
            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Spend</th>
                  <th>Share</th>
                  <th>ROAS</th>
                  <th>Allocation Bar</th>
                </tr>
              </thead>
              <tbody>
                {topSevenChannels.map((channel) => {
                  const spend = toNumber(channel.recommended_spend);
                  return (
                    <tr key={`print-${channel.channel}`}>
                      <td>{channel.channel}</td>
                      <td>{moneyFormatter.format(spend)}</td>
                      <td>{percentFormatter.format(toNumber(channel.recommended_share))}</td>
                      <td>{toNumber(channel.pred_roas).toFixed(2)}x</td>
                      <td>
                        <div className={styles.printBarTrack}>
                          <div
                            className={styles.printBarFill}
                            style={{ width: barWidth(spend, totalSpend) }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className={styles.printFooter}>Confidential - Prepared by Just Global | Page 3 of 4</footer>
        </article>

        <article className={styles.printPage}>
          <h2 className={styles.printPageHeading}>Detailed Channel Performance</h2>
          <div className={styles.printDetailTable}>
            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Spend</th>
                  <th>Share</th>
                  <th>Pipeline</th>
                  <th>Revenue</th>
                  <th>ROAS</th>
                  <th>CAC</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((row) => (
                  <tr key={`print-detail-${row.channel}`}>
                    <td>{row.channel}</td>
                    <td>{moneyFormatter.format(toNumber(row.recommended_spend))}</td>
                    <td>{percentFormatter.format(toNumber(row.recommended_share))}</td>
                    <td>{moneyFormatter.format(toNumber(row.pred_pipeline))}</td>
                    <td>{moneyFormatter.format(toNumber(row.pred_revenue))}</td>
                    <td>{toNumber(row.pred_roas).toFixed(2)}x</td>
                    <td>{moneyFormatter.format(toNumber(row.pred_cac))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className={styles.printFooter}>Confidential - Prepared by Just Global | Page 4 of 4</footer>
        </article>
      </section>
    </main>
  );
}
