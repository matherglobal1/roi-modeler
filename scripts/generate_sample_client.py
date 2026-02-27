from __future__ import annotations

import argparse
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from roi_modeler.sample_data import generate_sample_client_dataset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create realistic synthetic client data from a source client.")
    parser.add_argument("--source-client", default="autodesk")
    parser.add_argument("--target-client", default="sample_enterprise")
    parser.add_argument("--scale", type=float, default=0.85, help="Global scaling factor for sample client size.")
    parser.add_argument("--noise", type=float, default=0.12, help="Lognormal noise level.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--canonical-dir", default="data/canonical")
    parser.add_argument("--output-dir", default="data/sample")
    parser.add_argument("--configs-dir", default="configs/clients")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    canonical_dir = Path(args.canonical_dir).resolve()
    payload = generate_sample_client_dataset(
        source_client_id=args.source_client,
        target_client_id=args.target_client,
        source_performance_path=canonical_dir / f"{args.source_client}_performance.csv",
        source_baseline_path=canonical_dir / f"{args.source_client}_channel_baseline.csv",
        output_dir=Path(args.output_dir).resolve(),
        configs_dir=Path(args.configs_dir).resolve(),
        scale=args.scale,
        noise=args.noise,
        seed=args.seed,
    )
    print("Sample dataset generated")
    for key, value in payload.items():
        print(f"- {key}: {value}")


if __name__ == "__main__":
    main()
