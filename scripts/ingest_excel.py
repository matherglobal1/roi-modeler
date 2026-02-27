from __future__ import annotations

import argparse
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from roi_modeler.ingest import ingest_autodesk_workbook
from roi_modeler.io_utils import write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest Autodesk ROI workbook into canonical ROI model tables.")
    parser.add_argument("--workbook", required=True, help="Path to source XLSX workbook.")
    parser.add_argument("--client", default="autodesk", help="Client id slug.")
    parser.add_argument(
        "--output-dir",
        default="data/canonical",
        help="Folder for canonical CSV outputs.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    workbook_path = Path(args.workbook).expanduser().resolve()
    output_dir = Path(args.output_dir).resolve()
    metadata = ingest_autodesk_workbook(
        workbook_path=workbook_path,
        output_dir=output_dir,
        client_id=args.client,
    )

    run_request = {
        "client_id": args.client,
        "total_budget": metadata["modeled_total_budget"],
        "objective": "pipeline",
        "objective_overrides": {},
        "guardrails": {
            "min_roas": None,
            "max_cac": None,
        },
    }
    template_path = Path("data/templates") / "run_request_template.json"
    write_json(template_path.resolve(), run_request)

    print("Ingestion complete")
    print(f"- client: {metadata['client_id']}")
    print(f"- rows: {metadata['rows_performance']}")
    print(f"- channels: {metadata['channels']}")
    print(f"- modeled total budget: {metadata['modeled_total_budget']}")
    print(f"- baseline: {metadata['outputs']['baseline_csv']}")
    print(f"- constraints: {metadata['outputs']['constraints_csv']}")


if __name__ == "__main__":
    main()
