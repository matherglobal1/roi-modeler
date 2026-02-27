"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import type { RoiChannelRecommendation, RoiSnapshot } from "@/lib/roi-data";
import styles from "@/app/page.module.css";

const OBJECTIVE_LABELS: Record<string, string> = {
  pipeline: "Pipeline",
  revenue: "Revenue",
  roas: "ROAS",
  cac: "CAC",
};

const DONUT_COLORS = ["#14b8a6", "#06b6d4", "#22c55e", "#a3e635", "#f59e0b", "#f97316", "#ef4444"];

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

function getBarWidth(value: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.min(100, Math.max(0, (value / total) * 100)).toFixed(1)}%`;
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

type DashboardProps = {
  snapshot: RoiSnapshot;
  initialClientId?: string;
  initialScenarioId?: string;
};

export default function RoiDashboard({ snapshot, initialClientId, initialScenarioId }: DashboardProps) {
  const clients = snapshot.clients;
  const defaultClient = clients.find((client) => client.clientId === initialClientId) ?? clients[0];

  const [clientId, setClientId] = useState(defaultClient?.clientId ?? "");
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

  const totalSpend = toNumber(scenario?.summary.total_budget);
  const guardrailStatus = `${scenario?.summary.guardrail_status ?? "unknown"}`.toLowerCase();

  const donutData = useMemo(() => {
    if (!channels.length || totalSpend <= 0) {
      return { gradient: "#e2e8f0", slices: [] as Array<{ label: string; share: number; color: string }> };
    }
    let cursor = 0;
    const slices = channels.slice(0, 7).map((channel, index) => {
      const share = toNumber(channel.recommended_spend) / totalSpend;
      const start = cursor;
      cursor += share * 100;
      return {
        label: channel.channel,
        share,
        color: DONUT_COLORS[index % DONUT_COLORS.length],
        start,
        end: cursor,
      };
    });
    const gradient = slices
      .map((slice) => `${slice.color} ${slice.start.toFixed(2)}% ${slice.end.toFixed(2)}%`)
      .join(", ");
    return { gradient: `conic-gradient(${gradient})`, slices };
  }, [channels, totalSpend]);

  function handleClientSelect(nextClientId: string) {
    setClientId(nextClientId);
    const nextClient = clients.find((item) => item.clientId === nextClientId);
    setScenarioId(nextClient?.scenarios[0]?.id ?? "");
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

  return (
    <main className={styles.page}>
      <section className={styles.heroSection}>
        <div>
          <p className={styles.kicker}>ROI Modeller</p>
          <h1 className={styles.commandTitle}>Command Center</h1>
          <p className={styles.heroSubtitle}>
            Strategic budget recommendations across channels, built for executive review and weekly decision velocity.
          </p>
        </div>
        <div className={styles.heroMeta}>
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
                {client.clientId.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.controlField}>
          <span>Scenario</span>
          <select value={scenario.id} onChange={(event) => setScenarioId(event.target.value)}>
            {scenarioOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {formatObjective(item.objective)} • {formatTimestamp(item.timestamp)}
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

      <section className={styles.metricSection}>
        {[
          { label: "Total Budget", value: formatMetric(totalSpend, true) },
          { label: "Total Pipeline", value: formatMetric(toNumber(scenario.summary.total_pipeline), true) },
          { label: "Total Revenue", value: formatMetric(toNumber(scenario.summary.total_revenue), true) },
          { label: "Total HQLs", value: formatMetric(toNumber(scenario.summary.total_hqls)) },
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

      <section className={styles.chartSection}>
        <article className={styles.chartPanel}>
          <header className={styles.panelHeader}>
            <h2>Spend Allocation</h2>
            <p>
              Channel mix for {selectedClient.clientId.replaceAll("_", " ")} on{" "}
              {formatTimestamp(scenario.timestamp)}
            </p>
          </header>

          <div className={styles.chartBody}>
            <div className={styles.barList}>
              {channels.map((channel) => {
                const spend = toNumber(channel.recommended_spend);
                return (
                  <div key={channel.channel} className={styles.barRow}>
                    <div className={styles.barMeta}>
                      <strong>{channel.channel}</strong>
                      <span>{moneyFormatter.format(spend)}</span>
                    </div>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ width: getBarWidth(spend, totalSpend) }} />
                    </div>
                    <div className={styles.barStats}>
                      <span>{percentFormatter.format(toNumber(channel.recommended_share))} of budget</span>
                      <span>{toNumber(channel.pred_roas).toFixed(1)}x ROAS</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.donutPanel}>
              <div className={styles.donut} style={{ background: donutData.gradient }} />
              <ul className={styles.legend}>
                {donutData.slices.map((slice) => (
                  <li key={slice.label}>
                    <span style={{ backgroundColor: slice.color }} />
                    <em>{slice.label}</em>
                    <strong>{percentFormatter.format(slice.share)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>
      </section>

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
    </main>
  );
}

