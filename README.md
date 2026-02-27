# ROI Modeler (Multi-Client)

Dynamic, client-agnostic ROI optimizer built from a real client workbook, with realistic sample-data generation for demos.

## What this project does

1. Ingests Autodesk-style Excel data into canonical tables.
2. Builds channel response curves and default constraints.
3. Optimizes budget dynamically for `pipeline`, `revenue`, `roas`, or `cac`.
4. Generates realistic synthetic datasets for additional demo clients.

## Project structure

- `src/roi_modeler/`: core ingestion, optimization, and sample generation logic.
- `scripts/`: CLI wrappers for ingestion, optimization, and bootstrap runs.
- `configs/objectives.yaml`: objective weights you can tune.
- `configs/clients/*.yaml`: per-client data paths and run defaults.
- `data/canonical/`: client canonical outputs.
- `data/sample/`: generated sample client datasets.
- `data/templates/`: editable templates for constraints and run requests.

## Setup (PowerShell)

```powershell
cd C:\Users\WillMather\Documents\JG\Projects\apps-internal\roi-modeler
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## End-to-end run

```powershell
python scripts/ingest_excel.py --workbook "C:\Users\WillMather\Downloads\Autodesk ROI Model - January 2026 version.xlsx" --client autodesk
python scripts/generate_sample_client.py --source-client autodesk --target-client sample_enterprise
python scripts/run_optimizer.py --client autodesk --objective pipeline
python scripts/run_optimizer.py --client autodesk --objective revenue
python scripts/run_optimizer.py --client sample_enterprise --objective pipeline
```

One command bootstrap:

```powershell
.\scripts\bootstrap.ps1
```

## How users set hard caps

Edit `data/canonical/<client>_constraints.csv`:

- `min_spend`, `max_spend`: absolute hard caps.
- `locked_spend`: fixed budget for a channel.
- `min_share`, `max_share`: percentage-based caps.
- `enabled`: on/off channel.
- `min_roas`, `max_cac`: guardrail thresholds.

Then rerun optimizer.

## Notes

- Excel remains the input layer for now.
- Model uses diminishing-returns curves per channel (`alpha`, `beta`).
- `roas` and `cac` objectives are implemented via weighted scoring + guardrails.
