from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from roi_modeler.io_utils import as_bool, to_float


@dataclass
class OptimizationResult:
    allocation: pd.DataFrame
    summary: dict[str, Any]


def _build_weights(
    objective: str,
    objective_catalog: dict[str, Any],
    overrides: dict[str, float] | None,
) -> dict[str, float]:
    defaults = objective_catalog.get("objectives", {}).get(objective, {})
    if not defaults:
        raise ValueError(f"Unknown objective '{objective}'. Add it to configs/objectives.yaml.")
    weights = {
        "pipeline": float(defaults.get("pipeline", 0.0)),
        "revenue": float(defaults.get("revenue", 0.0)),
        "hqls": float(defaults.get("hqls", 0.0)),
        "leads": float(defaults.get("leads", 0.0)),
        "roas": float(defaults.get("roas", 0.0)),
        "cac": float(defaults.get("cac", 0.0)),
    }
    if overrides:
        for key, value in overrides.items():
            if key in weights:
                weights[key] = float(value)
    return weights


def _predict(row: pd.Series, spend: float) -> dict[str, float]:
    if spend <= 0:
        return {
            "pipeline": 0.0,
            "revenue": 0.0,
            "hqls": 0.0,
            "leads": 0.0,
            "roas": 0.0,
            "cac": 0.0,
        }

    beta = float(row["beta"])
    pipeline = float(row["alpha_pipeline"]) * spend**beta
    revenue = float(row["alpha_revenue"]) * spend**beta
    hqls = float(row["alpha_hqls"]) * spend**beta
    leads = float(row["alpha_leads"]) * spend**beta
    roas = revenue / spend if spend > 0 else 0.0
    cac = spend / hqls if hqls > 0 else 0.0
    return {
        "pipeline": pipeline,
        "revenue": revenue,
        "hqls": hqls,
        "leads": leads,
        "roas": roas,
        "cac": cac,
    }


def _score(metrics: dict[str, float], weights: dict[str, float]) -> float:
    return (
        weights["pipeline"] * metrics["pipeline"]
        + weights["revenue"] * metrics["revenue"]
        + weights["hqls"] * metrics["hqls"]
        + weights["leads"] * metrics["leads"]
        + weights["roas"] * metrics["roas"]
        - weights["cac"] * metrics["cac"]
    )


def _normalize_constraints(
    baseline_df: pd.DataFrame,
    constraints_df: pd.DataFrame,
    total_budget: float,
) -> pd.DataFrame:
    merged = baseline_df.merge(
        constraints_df.drop(columns=["client_id"], errors="ignore"),
        on="channel",
        how="left",
    )
    merged["enabled"] = merged["enabled"].apply(as_bool)

    for col in ["min_spend", "max_spend", "locked_spend", "min_share", "max_share", "min_roas", "max_cac"]:
        if col not in merged.columns:
            merged[col] = np.nan
        merged[col] = merged[col].apply(to_float)

    mins: list[float] = []
    maxes: list[float] = []
    for _, row in merged.iterrows():
        if not row["enabled"]:
            mins.append(0.0)
            maxes.append(0.0)
            continue

        locked = row["locked_spend"]
        if locked is not None and locked >= 0:
            mins.append(float(locked))
            maxes.append(float(locked))
            continue

        min_spend = float(row["min_spend"] or 0.0)
        max_spend = float(row["max_spend"] or total_budget)

        min_share = row["min_share"]
        max_share = row["max_share"]
        if min_share is not None:
            min_spend = max(min_spend, float(min_share) * total_budget)
        if max_share is not None:
            max_spend = min(max_spend, float(max_share) * total_budget)

        max_spend = max(max_spend, min_spend)
        mins.append(float(min_spend))
        maxes.append(float(max_spend))

    merged["min_spend_effective"] = mins
    merged["max_spend_effective"] = maxes
    return merged


def optimize_budget(
    baseline_df: pd.DataFrame,
    constraints_df: pd.DataFrame,
    run_request: dict[str, Any],
    objective_catalog: dict[str, Any],
) -> OptimizationResult:
    total_budget = float(run_request.get("total_budget") or baseline_df["baseline_spend"].sum())
    objective = str(run_request.get("objective", "pipeline")).strip().lower()
    overrides = run_request.get("objective_overrides") or {}
    weights = _build_weights(objective=objective, objective_catalog=objective_catalog, overrides=overrides)

    merged = _normalize_constraints(
        baseline_df=baseline_df.copy(),
        constraints_df=constraints_df.copy(),
        total_budget=total_budget,
    )

    min_total = float(merged["min_spend_effective"].sum())
    max_total = float(merged["max_spend_effective"].sum())
    if min_total - total_budget > 1e-6:
        raise ValueError(f"Infeasible constraints: min spend {min_total:.2f} exceeds budget {total_budget:.2f}.")
    if max_total + 1e-6 < total_budget:
        raise ValueError(f"Infeasible constraints: max spend {max_total:.2f} below budget {total_budget:.2f}.")

    allocation = merged["min_spend_effective"].astype(float).copy()
    remaining = float(total_budget - allocation.sum())
    step = max(total_budget / 400.0, 50.0)

    for _ in range(100000):
        if remaining <= 1e-9:
            break
        best_idx: int | None = None
        best_gain = -float("inf")
        best_delta = 0.0

        for idx, row in merged.iterrows():
            if not bool(row["enabled"]):
                continue
            current = float(allocation.iloc[idx])
            max_spend = float(row["max_spend_effective"])
            if current >= max_spend - 1e-9:
                continue

            delta = min(step, remaining, max_spend - current)
            current_score = _score(_predict(row, current), weights)
            next_score = _score(_predict(row, current + delta), weights)
            gain = next_score - current_score

            if gain > best_gain:
                best_gain = gain
                best_idx = idx
                best_delta = delta

        if best_idx is None:
            break
        allocation.iloc[best_idx] += best_delta
        remaining -= best_delta

    if remaining > 1e-6:
        available = (merged["max_spend_effective"] - allocation).clip(lower=0.0)
        if available.sum() > 0:
            distribution = available / available.sum()
            add = distribution * remaining
            allocation = allocation + add
            remaining = 0.0

    rows: list[dict[str, Any]] = []
    for idx, row in merged.iterrows():
        spend = float(allocation.iloc[idx])
        pred = _predict(row, spend)
        rows.append(
            {
                "client_id": row.get("client_id", run_request.get("client_id")),
                "channel": row["channel"],
                "recommended_spend": round(spend, 2),
                "recommended_share": round(spend / total_budget, 4) if total_budget > 0 else 0.0,
                "pred_pipeline": round(pred["pipeline"], 2),
                "pred_revenue": round(pred["revenue"], 2),
                "pred_hqls": round(pred["hqls"], 2),
                "pred_leads": round(pred["leads"], 2),
                "pred_roas": round(pred["roas"], 4),
                "pred_cac": round(pred["cac"], 4),
                "min_spend": round(float(row["min_spend_effective"]), 2),
                "max_spend": round(float(row["max_spend_effective"]), 2),
            }
        )
    allocation_df = pd.DataFrame(rows).sort_values(by="recommended_spend", ascending=False).reset_index(drop=True)

    total_pipeline = float(allocation_df["pred_pipeline"].sum())
    total_revenue = float(allocation_df["pred_revenue"].sum())
    total_hqls = float(allocation_df["pred_hqls"].sum())
    overall_roas = total_revenue / total_budget if total_budget > 0 else 0.0
    overall_cac = total_budget / total_hqls if total_hqls > 0 else 0.0

    guardrails = run_request.get("guardrails") or {}
    min_roas = to_float(guardrails.get("min_roas")) if isinstance(guardrails, dict) else None
    max_cac = to_float(guardrails.get("max_cac")) if isinstance(guardrails, dict) else None
    guardrail_status = "pass"
    if min_roas is not None and overall_roas < min_roas:
        guardrail_status = "fail"
    if max_cac is not None and overall_cac > max_cac:
        guardrail_status = "fail"

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "client_id": run_request.get("client_id"),
        "objective": objective,
        "weights": weights,
        "total_budget": round(total_budget, 2),
        "total_pipeline": round(total_pipeline, 2),
        "total_revenue": round(total_revenue, 2),
        "total_hqls": round(total_hqls, 2),
        "overall_roas": round(overall_roas, 4),
        "overall_cac": round(overall_cac, 4),
        "guardrail_status": guardrail_status,
        "unallocated_budget": round(remaining, 6),
    }
    return OptimizationResult(allocation=allocation_df, summary=summary)

