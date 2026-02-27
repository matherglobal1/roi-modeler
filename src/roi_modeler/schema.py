from __future__ import annotations

PERFORMANCE_COLUMNS = [
    "client_id",
    "geo",
    "channel",
    "sub_channel",
    "platform",
    "fiscal_year",
    "fiscal_quarter",
    "quarter_label",
    "period_start",
    "engaged_leads",
    "hqls",
    "opps_sourced",
    "pipeline_sourced",
    "pipeline_influenced",
    "cw_opps_sourced",
    "cw_acv_sourced",
    "cw_acv_influenced",
    "hql_to_opp_conversion",
    "source_file",
    "ingested_at",
]

BASELINE_COLUMNS = [
    "client_id",
    "channel",
    "baseline_spend",
    "baseline_share",
    "engaged_leads",
    "hqls",
    "opps_sourced",
    "pipeline_sourced",
    "cw_acv_sourced",
    "roas_baseline",
    "cac_baseline",
    "beta",
    "alpha_pipeline",
    "alpha_revenue",
    "alpha_hqls",
    "alpha_leads",
    "notes",
]

CONSTRAINT_COLUMNS = [
    "client_id",
    "channel",
    "enabled",
    "min_spend",
    "max_spend",
    "locked_spend",
    "min_share",
    "max_share",
    "min_roas",
    "max_cac",
    "notes",
]

RUN_REQUEST_KEYS = [
    "client_id",
    "total_budget",
    "objective",
    "objective_overrides",
    "guardrails",
]

NUMERIC_PERFORMANCE_COLUMNS = [
    "engaged_leads",
    "hqls",
    "opps_sourced",
    "pipeline_sourced",
    "pipeline_influenced",
    "cw_opps_sourced",
    "cw_acv_sourced",
    "cw_acv_influenced",
    "hql_to_opp_conversion",
]

