from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from roi_modeler.ingest import build_default_constraints
from roi_modeler.io_utils import ensure_dir, write_yaml


def generate_sample_client_dataset(
    source_client_id: str,
    target_client_id: str,
    source_performance_path: Path,
    source_baseline_path: Path,
    output_dir: Path,
    configs_dir: Path,
    scale: float = 0.85,
    noise: float = 0.12,
    seed: int = 42,
) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    ensure_dir(output_dir)
    ensure_dir(configs_dir)

    performance = pd.read_csv(source_performance_path)
    baseline = pd.read_csv(source_baseline_path)

    performance = performance[performance["client_id"] == source_client_id].copy()
    if performance.empty:
        raise ValueError(f"No source performance rows found for client '{source_client_id}'.")

    baseline = baseline[baseline["client_id"] == source_client_id].copy()
    if baseline.empty:
        raise ValueError(f"No source baseline rows found for client '{source_client_id}'.")

    numeric_perf_cols = [
        "engaged_leads",
        "hqls",
        "opps_sourced",
        "pipeline_sourced",
        "pipeline_influenced",
        "cw_opps_sourced",
        "cw_acv_sourced",
        "cw_acv_influenced",
    ]
    for col in numeric_perf_cols:
        sampled = performance[col].astype(float) * scale * rng.lognormal(mean=0.0, sigma=noise, size=len(performance))
        if col in {"engaged_leads", "hqls", "opps_sourced", "cw_opps_sourced"}:
            performance[col] = sampled.round(0).astype(int)
        else:
            performance[col] = sampled.round(2)
    performance["hql_to_opp_conversion"] = np.where(
        performance["hqls"] > 0,
        performance["opps_sourced"] / performance["hqls"],
        0.0,
    )
    performance["client_id"] = target_client_id

    numeric_base_cols = [
        "baseline_spend",
        "engaged_leads",
        "hqls",
        "opps_sourced",
        "pipeline_sourced",
        "cw_acv_sourced",
    ]
    for col in numeric_base_cols:
        baseline[col] = (
            baseline[col].astype(float)
            * scale
            * rng.lognormal(mean=0.0, sigma=noise * 0.8, size=len(baseline))
        ).round(2)
    baseline["baseline_share"] = baseline["baseline_spend"] / baseline["baseline_spend"].sum()
    baseline["alpha_pipeline"] = np.where(
        baseline["baseline_spend"] > 0,
        baseline["pipeline_sourced"] / np.power(baseline["baseline_spend"], baseline["beta"]),
        0.0,
    )
    baseline["alpha_revenue"] = np.where(
        baseline["baseline_spend"] > 0,
        baseline["cw_acv_sourced"] / np.power(baseline["baseline_spend"], baseline["beta"]),
        0.0,
    )
    baseline["alpha_hqls"] = np.where(
        baseline["baseline_spend"] > 0,
        baseline["hqls"] / np.power(baseline["baseline_spend"], baseline["beta"]),
        0.0,
    )
    baseline["alpha_leads"] = np.where(
        baseline["baseline_spend"] > 0,
        baseline["engaged_leads"] / np.power(baseline["baseline_spend"], baseline["beta"]),
        0.0,
    )
    baseline["roas_baseline"] = np.where(
        baseline["baseline_spend"] > 0,
        baseline["cw_acv_sourced"] / baseline["baseline_spend"],
        0.0,
    )
    baseline["cac_baseline"] = np.where(
        baseline["hqls"] > 0,
        baseline["baseline_spend"] / baseline["hqls"],
        0.0,
    )
    baseline["client_id"] = target_client_id
    baseline["notes"] = f"Synthetic sample scaled from {source_client_id} patterns."

    total_budget = float(baseline["baseline_spend"].sum())
    constraints = build_default_constraints(
        baseline_df=baseline,
        client_id=target_client_id,
        total_budget=total_budget,
    )

    perf_out = output_dir / f"{target_client_id}_performance.csv"
    baseline_out = output_dir / f"{target_client_id}_channel_baseline.csv"
    constraints_out = output_dir / f"{target_client_id}_constraints.csv"

    performance.to_csv(perf_out, index=False)
    baseline.to_csv(baseline_out, index=False)
    constraints.to_csv(constraints_out, index=False)

    config_payload = {
        "client_id": target_client_id,
        "description": f"Synthetic demo dataset generated from {source_client_id}.",
        "data": {
            "performance_csv": str(perf_out.as_posix()),
            "baseline_csv": str(baseline_out.as_posix()),
            "constraints_csv": str(constraints_out.as_posix()),
        },
        "run_defaults": {
            "objective": "pipeline",
            "total_budget": round(total_budget, 2),
            "guardrails": {
                "min_roas": round(float(baseline["roas_baseline"].mean()) * 0.70, 4),
                "max_cac": round(float(baseline["cac_baseline"].replace(0, np.nan).mean()) * 1.4, 4),
            },
        },
    }
    config_out = configs_dir / f"{target_client_id}.yaml"
    write_yaml(config_out, config_payload)

    return {
        "performance_csv": str(perf_out),
        "baseline_csv": str(baseline_out),
        "constraints_csv": str(constraints_out),
        "config_yaml": str(config_out),
    }

