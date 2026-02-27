"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import type { RoiChannelRecommendation, RoiSnapshot } from "@/lib/roi-data";
import styles from "@/app/page.module.css";

const OBJECTIVE_ORDER = ["pipeline", "revenue", "roas", "cac"];

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
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function formatMetric(value: number, asMoney = false): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (asMoney) {
    return moneyFormatter.format(value);
  }
  return compactFormatter.format(value);
}

function formatObjective(objective: string): string {
  return OBJECTIVE_LABELS[objective] ?? objective.toUpperCase();
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
  const ratio = Math.max(0, Math.min(1, value / total));
  return `${(ratio * 100).toFixed(1)}%`;
}

export default function RoiDashboard({ snapshot }: { snapshot: RoiSnapshot }) {
  const clients = snapshot.clients;

  const [clientId, setClientId] = useState(clients[0]?.clientId ?? "");
  const selectedClient = useMemo(() => {
    return clients.find((client) => client.clientId === clientId) ?? clients[0];
  }, [clientId, clients]);

  const availableObjectives = useMemo(() => {
    if (!selectedClient) {
      return [];
    }
    return [...selectedClient.scenarios]
      .sort((a, b) => {
        const left = OBJECTIVE_ORDER.indexOf(a.objective);
        const right = OBJECTIVE_ORDER.indexOf(b.objective);
        return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
      })
      .map((scenario) => scenario.objective);
  }, [selectedClient]);

  const [objective, setObjective] = useState(availableObjectives[0] ?? "");

  function handleClientSelect(nextClientId: string) {
    setClientId(nextClientId);
    const nextClient = clients.find((client) => client.clientId === nextClientId);
    const nextObjective =
      [...(nextClient?.scenarios ?? [])]
        .sort((a, b) => {
          const left = OBJECTIVE_ORDER.indexOf(a.objective);
          const right = OBJECTIVE_ORDER.indexOf(b.objective);
          return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
        })
        .map((item) => item.objective)[0] ?? "";
    setObjective(nextObjective);
  }

  const scenario = useMemo(() => {
    if (!selectedClient) {
      return undefined;
    }
    return (
      selectedClient.scenarios.find((item) => item.objective === objective) ?? selectedClient.scenarios[0]
    );
  }, [selectedClient, objective]);

  const channels = useMemo(() => {
    const data = [...(scenario?.recommendations ?? [])];
    return data.sort((a, b) => toNumber(b.recommended_spend) - toNumber(a.recommended_spend));
  }, [scenario]);

  const totalSpend = toNumber(scenario?.summary.total_budget);
  const guardrailStatus = `${scenario?.summary.guardrail_status ?? "unknown"}`.toLowerCase();

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
      <section className={styles.hero}>
        <div className={styles.heroTopline}>
          <span className={styles.kicker}>ROI Modeller Command Center</span>
          <span className={styles.sourceTag}>{snapshot.source === "demo" ? "Demo data" : "Live optimizer outputs"}</span>
        </div>
        <h1 className={styles.headline}>Budget Recommendations at Decision Speed</h1>
        <p className={styles.subtitle}>
          Compare objective strategies, inspect channel-level allocations, and move from spreadsheet outputs to a
          decision-grade interface.
        </p>
      </section>

      <section className={styles.controlPanel}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Client</span>
          <div className={styles.chipRow}>
            {clients.map((client) => (
              <button
                key={client.clientId}
                type="button"
                className={`${styles.chip} ${client.clientId === selectedClient.clientId ? styles.chipActive : ""}`}
                onClick={() => handleClientSelect(client.clientId)}
              >
                {client.clientId.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Objective</span>
          <div className={styles.chipRow}>
            {availableObjectives.map((item) => (
              <button
                key={item}
                type="button"
                className={`${styles.chip} ${item === scenario.objective ? styles.chipActive : ""}`}
                onClick={() => setObjective(item)}
              >
                {formatObjective(item)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.metaPanel}>
          <span>Scenario timestamp</span>
          <strong>{formatTimestamp(scenario.timestamp)}</strong>
        </div>
      </section>

      <section className={styles.metricGrid}>
        {[
          { label: "Total Budget", value: formatMetric(totalSpend, true) },
          { label: "Total Pipeline", value: formatMetric(toNumber(scenario.summary.total_pipeline), true) },
          { label: "Total Revenue", value: formatMetric(toNumber(scenario.summary.total_revenue), true) },
          { label: "HQLs", value: formatMetric(toNumber(scenario.summary.total_hqls)) },
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

      <section className={styles.mainGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2>Spend Allocation</h2>
            <p>Channel mix optimized for {formatObjective(scenario.objective)}</p>
          </header>
          <div className={styles.barList}>
            {channels.map((channel) => {
              const spend = toNumber(channel.recommended_spend);
              return (
                <div key={channel.channel} className={styles.barRow}>
                  <div className={styles.barMeta}>
                    <span>{channel.channel}</span>
                    <span>{moneyFormatter.format(spend)}</span>
                  </div>
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ width: getBarWidth(spend, totalSpend) }} />
                  </div>
                  <div className={styles.rowStats}>
                    <span>{percentFormatter.format(toNumber(channel.recommended_share))}</span>
                    <span>{toNumber(channel.pred_roas).toFixed(1)}x ROAS</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2>Guardrails and System Health</h2>
            <p>Execution confidence for this scenario</p>
          </header>
          <div className={styles.healthStack}>
            <div className={styles.healthItem}>
              <span>Guardrail status</span>
              <strong className={guardrailStatus === "pass" ? styles.pass : styles.warn}>
                {guardrailStatus.toUpperCase()}
              </strong>
            </div>
            <div className={styles.healthItem}>
              <span>Unallocated budget</span>
              <strong>{moneyFormatter.format(toNumber(scenario.summary.unallocated_budget))}</strong>
            </div>
            <div className={styles.healthItem}>
              <span>Source summary file</span>
              <strong>{scenario.summaryFile}</strong>
            </div>
            <div className={styles.healthItem}>
              <span>Source recommendation file</span>
              <strong>{scenario.recommendationFile}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className={styles.tablePanel}>
        <header className={styles.panelHeader}>
          <h2>Channel Detail</h2>
          <p>Predicted impact and operating bounds</p>
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
