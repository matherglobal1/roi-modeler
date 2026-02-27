from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from roi_modeler.io_utils import read_json, read_yaml, write_json
from roi_modeler.optimize import optimize_budget


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run dynamic ROI budget optimization.")
    parser.add_argument("--client", required=True, help="Client id with matching config in configs/clients.")
    parser.add_argument("--objective", default=None, help="Objective name from configs/objectives.yaml.")
    parser.add_argument("--budget", type=float, default=None, help="Override total budget.")
    parser.add_argument("--run-request", default=None, help="Optional JSON run request path.")
    parser.add_argument(
        "--output-dir",
        default="data/canonical/outputs",
        help="Directory for optimization outputs.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    client_config_path = Path("configs/clients") / f"{args.client}.yaml"
    objective_catalog_path = Path("configs/objectives.yaml")
    if not client_config_path.exists():
        raise FileNotFoundError(f"Missing client config: {client_config_path}")
    if not objective_catalog_path.exists():
        raise FileNotFoundError(f"Missing objective catalog: {objective_catalog_path}")

    client_cfg = read_yaml(client_config_path.resolve())
    objective_catalog = read_yaml(objective_catalog_path.resolve())

    baseline_path = Path(client_cfg["data"]["baseline_csv"]).resolve()
    constraints_path = Path(client_cfg["data"]["constraints_csv"]).resolve()
    baseline_df = pd.read_csv(baseline_path)
    constraints_df = pd.read_csv(constraints_path)

    run_request = {
        "client_id": client_cfg["client_id"],
        "total_budget": client_cfg.get("run_defaults", {}).get("total_budget", float(baseline_df["baseline_spend"].sum())),
        "objective": client_cfg.get("run_defaults", {}).get("objective", "pipeline"),
        "objective_overrides": {},
        "guardrails": client_cfg.get("run_defaults", {}).get("guardrails", {}),
    }

    if args.run_request:
        run_request.update(read_json(Path(args.run_request).resolve()))
    if args.objective:
        run_request["objective"] = args.objective
    if args.budget:
        run_request["total_budget"] = float(args.budget)

    result = optimize_budget(
        baseline_df=baseline_df,
        constraints_df=constraints_df,
        run_request=run_request,
        objective_catalog=objective_catalog,
    )

    out_dir = Path(args.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    objective_slug = str(run_request.get("objective", "pipeline")).lower()
    recommendation_path = out_dir / f"{args.client}_{objective_slug}_recommendation_{timestamp}.csv"
    summary_path = out_dir / f"{args.client}_{objective_slug}_summary_{timestamp}.json"
    result.allocation.to_csv(recommendation_path, index=False)
    write_json(summary_path, result.summary)

    print(f"Optimization complete for client: {args.client}")
    print(f"- objective: {result.summary['objective']}")
    print(f"- budget: {result.summary['total_budget']}")
    print(f"- pipeline: {result.summary['total_pipeline']}")
    print(f"- revenue: {result.summary['total_revenue']}")
    print(f"- hqls: {result.summary['total_hqls']}")
    print(f"- overall roas: {result.summary['overall_roas']}")
    print(f"- overall cac: {result.summary['overall_cac']}")
    print(f"- guardrail status: {result.summary['guardrail_status']}")
    print(f"- recommendation csv: {recommendation_path}")
    print(f"- summary json: {summary_path}")


if __name__ == "__main__":
    main()
