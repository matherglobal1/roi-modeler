from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from roi_modeler.io_utils import ensure_dir, to_float, write_json
from roi_modeler.schema import (
    BASELINE_COLUMNS,
    CONSTRAINT_COLUMNS,
    NUMERIC_PERFORMANCE_COLUMNS,
    PERFORMANCE_COLUMNS,
)

ALL_DATA_SHEET = "Autodesk All data"
ROI_MODELLER_SHEET = "ROI Modeller"

ALL_DATA_RENAME = {
    "quarter": "fiscal_quarter",
    "fiscal year": "fiscal_year",
    "starting quarter date": "period_start",
    "quarter2": "quarter_label",
    "geo": "geo",
    "channel": "channel",
    "sub channel": "sub_channel",
    "platform": "platform",
    "engaged leads": "engaged_leads",
    "hqls": "hqls",
    "opps sourced": "opps_sourced",
    "pipeline sourced": "pipeline_sourced",
    "pipeline influenced": "pipeline_influenced",
    "cw opps sourced": "cw_opps_sourced",
    "cw acv sourced": "cw_acv_sourced",
    "cw acv influenced": "cw_acv_influenced",
    "hql-to-opp conversion": "hql_to_opp_conversion",
}

BETA_BY_CHANNEL = {
    "content syndication": 0.72,
    "paid search": 0.78,
    "paid social": 0.74,
    "paid review site": 0.70,
    "paid referral": 0.68,
    "paid programmatic": 0.69,
    "paid display": 0.66,
    "paid video": 0.67,
}


def _snake_case_columns(columns: list[str]) -> list[str]:
    cleaned: list[str] = []
    for name in columns:
        text = str(name).strip().lower().replace("  ", " ")
        cleaned.append(text)
    return cleaned


def load_performance_data(workbook_path: Path, client_id: str) -> pd.DataFrame:
    source = pd.read_excel(workbook_path, sheet_name=ALL_DATA_SHEET)
    source = source.loc[:, ~source.columns.str.contains("^Unnamed")]
    source.columns = _snake_case_columns([str(col) for col in source.columns])
    source = source.rename(columns=ALL_DATA_RENAME)

    required_columns = [
        "fiscal_quarter",
        "fiscal_year",
        "period_start",
        "quarter_label",
        "geo",
        "channel",
        "sub_channel",
        "platform",
    ]
    missing = [col for col in required_columns if col not in source.columns]
    if missing:
        raise ValueError(f"Workbook missing required columns: {missing}")

    source["client_id"] = client_id
    source["source_file"] = workbook_path.name
    source["ingested_at"] = datetime.now(timezone.utc).isoformat()

    for numeric_col in NUMERIC_PERFORMANCE_COLUMNS:
        if numeric_col not in source.columns:
            source[numeric_col] = 0.0
        source[numeric_col] = (
            source[numeric_col]
            .apply(to_float)
            .fillna(0.0)
            .astype(float)
        )

    source["period_start"] = pd.to_datetime(source["period_start"], errors="coerce")
    source["fiscal_year"] = pd.to_numeric(source["fiscal_year"], errors="coerce").fillna(0).astype(int)
    source["quarter_label"] = source["quarter_label"].fillna("Unknown").astype(str)
    source["fiscal_quarter"] = source["fiscal_quarter"].fillna("Unknown").astype(str)
    source["geo"] = source["geo"].fillna("Unknown").astype(str)
    source["channel"] = source["channel"].fillna("Unknown").astype(str)
    source["sub_channel"] = source["sub_channel"].fillna("Unknown").astype(str)
    source["platform"] = source["platform"].fillna("Unknown").astype(str)

    output = source[PERFORMANCE_COLUMNS].copy()
    valid_channel_mask = output["channel"].str.lower().str.startswith(("paid", "content"))
    output = output[valid_channel_mask]
    output["period_start"] = output["period_start"].dt.strftime("%Y-%m-%d")
    return output


def extract_budget_and_splits(
    workbook_path: Path,
    channels: list[str],
) -> tuple[float, pd.DataFrame]:
    raw = pd.read_excel(workbook_path, sheet_name=ROI_MODELLER_SHEET, header=None)

    budget_candidates: list[float] = []
    for row_idx in range(raw.shape[0]):
        for col_idx in range(raw.shape[1]):
            value = raw.iat[row_idx, col_idx]
            if str(value).strip().lower() == "budget":
                right_value = raw.iat[row_idx, col_idx + 1] if col_idx + 1 < raw.shape[1] else None
                numeric = to_float(right_value)
                if numeric and numeric > 0:
                    budget_candidates.append(numeric)
    total_budget = max(budget_candidates) if budget_candidates else 0.0

    split_rows: list[dict[str, Any]] = []
    col_channel = 2
    col_split = 3
    col_spend = 4
    for channel in channels:
        mask = raw[col_channel].astype(str).str.strip().str.lower() == channel.strip().lower()
        if not mask.any():
            split_rows.append(
                {
                    "channel": channel,
                    "split_pct": None,
                    "split_spend": None,
                }
            )
            continue
        row_idx = mask[mask].index[0]
        split_pct = to_float(raw.iat[row_idx, col_split])
        split_spend = to_float(raw.iat[row_idx, col_spend])
        if split_pct is not None and split_pct > 1:
            split_pct /= 100.0
        split_rows.append(
            {
                "channel": channel,
                "split_pct": split_pct,
                "split_spend": split_spend,
            }
        )

    split_df = pd.DataFrame(split_rows)
    if total_budget > 0 and split_df["split_spend"].fillna(0).sum() == 0:
        split_df["split_spend"] = split_df["split_pct"].fillna(0) * total_budget
    if total_budget > 0 and split_df["split_pct"].fillna(0).sum() == 0:
        split_df["split_pct"] = split_df["split_spend"].fillna(0) / total_budget
    return float(total_budget), split_df


def build_channel_baseline(
    performance_df: pd.DataFrame,
    split_df: pd.DataFrame,
    client_id: str,
    total_budget: float,
) -> pd.DataFrame:
    metrics = performance_df.groupby("channel", as_index=False).agg(
        engaged_leads=("engaged_leads", "sum"),
        hqls=("hqls", "sum"),
        opps_sourced=("opps_sourced", "sum"),
        pipeline_sourced=("pipeline_sourced", "sum"),
        cw_acv_sourced=("cw_acv_sourced", "sum"),
    )
    baseline = metrics.merge(split_df, on="channel", how="left")
    baseline["baseline_spend"] = baseline["split_spend"].fillna(0.0)

    if total_budget > 0:
        missing_mask = baseline["baseline_spend"] <= 0
        if missing_mask.any():
            allocation_base = baseline.loc[missing_mask, "pipeline_sourced"].copy()
            fallback_hqls = baseline.loc[missing_mask, "hqls"]
            allocation_base = allocation_base.where(allocation_base > 0, fallback_hqls)
            allocation_total = float(allocation_base.sum())
            remaining_budget = max(total_budget - float(baseline["baseline_spend"].sum()), 0.0)
            if allocation_total > 0 and remaining_budget > 0:
                baseline.loc[missing_mask, "baseline_spend"] = allocation_base / allocation_total * remaining_budget

        productive_zero_spend = (baseline["baseline_spend"] <= 0) & (
            (baseline["pipeline_sourced"] > 0) | (baseline["hqls"] > 0)
        )
        if productive_zero_spend.any():
            productive_nonzero = (baseline["baseline_spend"] > 0) & (baseline["pipeline_sourced"] > 0)
            if productive_nonzero.any():
                median_pipeline_per_dollar = (
                    baseline.loc[productive_nonzero, "pipeline_sourced"]
                    / baseline.loc[productive_nonzero, "baseline_spend"]
                ).median()
            else:
                median_pipeline_per_dollar = 40.0
            if median_pipeline_per_dollar <= 0:
                median_pipeline_per_dollar = 40.0

            proxy_spend = baseline.loc[productive_zero_spend, "pipeline_sourced"] / median_pipeline_per_dollar
            proxy_floor = total_budget * 0.01
            proxy_spend = proxy_spend.clip(lower=proxy_floor)
            baseline.loc[productive_zero_spend, "baseline_spend"] = proxy_spend

        spend_total = float(baseline["baseline_spend"].sum())
        if spend_total > 0:
            baseline["baseline_spend"] = baseline["baseline_spend"] * (total_budget / spend_total)

    total_spend = float(baseline["baseline_spend"].sum())
    if total_spend <= 0 and total_budget > 0:
        baseline["baseline_spend"] = total_budget / max(len(baseline), 1)
        total_spend = float(baseline["baseline_spend"].sum())

    baseline["baseline_share"] = baseline["baseline_spend"] / total_spend if total_spend > 0 else 0.0
    baseline["beta"] = baseline["channel"].str.lower().map(BETA_BY_CHANNEL).fillna(0.72)

    def alpha(metric_col: str) -> pd.Series:
        spend = baseline["baseline_spend"].astype(float)
        metric = baseline[metric_col].astype(float)
        denominator = spend.pow(baseline["beta"].astype(float)).replace(0.0, np.nan)
        return (metric / denominator).fillna(0.0).astype(float)

    baseline["alpha_pipeline"] = alpha("pipeline_sourced")
    baseline["alpha_revenue"] = alpha("cw_acv_sourced")
    baseline["alpha_hqls"] = alpha("hqls")
    baseline["alpha_leads"] = alpha("engaged_leads")

    baseline["roas_baseline"] = baseline.apply(
        lambda row: row["cw_acv_sourced"] / row["baseline_spend"] if row["baseline_spend"] > 0 else 0.0,
        axis=1,
    )
    baseline["cac_baseline"] = baseline.apply(
        lambda row: row["baseline_spend"] / row["hqls"] if row["hqls"] > 0 else 0.0,
        axis=1,
    )
    baseline["client_id"] = client_id
    baseline["notes"] = "Derived from Autodesk workbook history + modeled diminishing returns."

    output = baseline[BASELINE_COLUMNS].sort_values(by="baseline_spend", ascending=False).reset_index(drop=True)
    return output


def build_default_constraints(
    baseline_df: pd.DataFrame,
    client_id: str,
    total_budget: float,
) -> pd.DataFrame:
    constraints = baseline_df[["channel", "baseline_spend", "roas_baseline", "cac_baseline"]].copy()

    def min_spend_for(row: pd.Series) -> float:
        if row["baseline_spend"] <= 0:
            return 0.0
        return round(float(row["baseline_spend"]) * 0.40, 2)

    def max_spend_for(row: pd.Series) -> float:
        if total_budget <= 0:
            return round(float(row["baseline_spend"]) * 1.8, 2)
        limit = max(float(row["baseline_spend"]) * 1.8, total_budget * 0.10)
        return round(min(limit, total_budget * 0.75), 2)

    constraints["enabled"] = baseline_df["baseline_spend"] > 0
    constraints["min_spend"] = constraints.apply(min_spend_for, axis=1)
    constraints["max_spend"] = constraints.apply(max_spend_for, axis=1)
    constraints["locked_spend"] = pd.NA
    constraints["min_share"] = constraints["min_spend"] / total_budget if total_budget > 0 else pd.NA
    constraints["max_share"] = constraints["max_spend"] / total_budget if total_budget > 0 else pd.NA
    constraints["min_roas"] = (constraints["roas_baseline"] * 0.70).replace(0, pd.NA)
    constraints["max_cac"] = (constraints["cac_baseline"] * 1.40).replace(0, pd.NA)
    constraints["notes"] = "User-editable hard caps and guardrails."
    constraints["client_id"] = client_id

    output = constraints[CONSTRAINT_COLUMNS].copy()
    return output


def ingest_autodesk_workbook(
    workbook_path: Path,
    output_dir: Path,
    client_id: str = "autodesk",
) -> dict[str, Any]:
    ensure_dir(output_dir)

    performance_df = load_performance_data(workbook_path=workbook_path, client_id=client_id)
    channels = sorted(performance_df["channel"].dropna().unique().tolist())
    total_budget, split_df = extract_budget_and_splits(workbook_path=workbook_path, channels=channels)
    baseline_df = build_channel_baseline(
        performance_df=performance_df,
        split_df=split_df,
        client_id=client_id,
        total_budget=total_budget,
    )
    constraints_df = build_default_constraints(
        baseline_df=baseline_df,
        client_id=client_id,
        total_budget=total_budget if total_budget > 0 else float(baseline_df["baseline_spend"].sum()),
    )

    performance_path = output_dir / f"{client_id}_performance.csv"
    baseline_path = output_dir / f"{client_id}_channel_baseline.csv"
    constraints_path = output_dir / f"{client_id}_constraints.csv"
    metadata_path = output_dir / f"{client_id}_ingestion_metadata.json"

    performance_df.to_csv(performance_path, index=False)
    baseline_df.to_csv(baseline_path, index=False)
    constraints_df.to_csv(constraints_path, index=False)

    metadata = {
        "client_id": client_id,
        "workbook_path": str(workbook_path),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rows_performance": int(len(performance_df)),
        "channels": int(baseline_df["channel"].nunique()),
        "modeled_total_budget": float(total_budget),
        "outputs": {
            "performance_csv": str(performance_path),
            "baseline_csv": str(baseline_path),
            "constraints_csv": str(constraints_path),
        },
    }
    write_json(metadata_path, metadata)
    return metadata
