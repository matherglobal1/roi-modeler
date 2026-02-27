# Canonical Data Contract

## 1) Performance table

File: `data/canonical/<client>_performance.csv`

Required columns:

- `client_id`
- `geo`
- `channel`
- `sub_channel`
- `platform`
- `fiscal_year`
- `fiscal_quarter`
- `quarter_label`
- `period_start`
- `engaged_leads`
- `hqls`
- `opps_sourced`
- `pipeline_sourced`
- `pipeline_influenced`
- `cw_opps_sourced`
- `cw_acv_sourced`
- `cw_acv_influenced`
- `hql_to_opp_conversion`
- `source_file`
- `ingested_at`

## 2) Channel baseline table

File: `data/canonical/<client>_channel_baseline.csv`

Defines modeled response curves:

- `baseline_spend`, `baseline_share`
- core outcomes (`pipeline_sourced`, `cw_acv_sourced`, `hqls`, `engaged_leads`)
- curve parameters:
  - `beta` (diminishing return shape)
  - `alpha_pipeline`
  - `alpha_revenue`
  - `alpha_hqls`
  - `alpha_leads`

## 3) Constraints table

File: `data/canonical/<client>_constraints.csv`

User-editable controls:

- `enabled`
- `min_spend`
- `max_spend`
- `locked_spend`
- `min_share`
- `max_share`
- `min_roas`
- `max_cac`

## 4) Run request

Optional JSON for each optimization run:

- `total_budget`
- `objective` (`pipeline`, `revenue`, `roas`, `cac`)
- `objective_overrides` (weight overrides)
- `guardrails` (`min_roas`, `max_cac`)
