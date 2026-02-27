param(
  [string]$WorkbookPath = "C:\Users\WillMather\Downloads\Autodesk ROI Model - January 2026 version.xlsx",
  [string]$Client = "autodesk"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
  throw "Missing .venv Python at $venvPython. Create venv and install requirements first."
}

& $venvPython "scripts/ingest_excel.py" "--workbook" $WorkbookPath "--client" $Client
if ($LASTEXITCODE -ne 0) { throw "Ingestion failed." }

& $venvPython "scripts/generate_sample_client.py" "--source-client" $Client "--target-client" "sample_enterprise"
if ($LASTEXITCODE -ne 0) { throw "Sample generation failed." }

& $venvPython "scripts/run_optimizer.py" "--client" $Client "--objective" "pipeline"
if ($LASTEXITCODE -ne 0) { throw "Pipeline objective run failed." }

& $venvPython "scripts/run_optimizer.py" "--client" $Client "--objective" "revenue"
if ($LASTEXITCODE -ne 0) { throw "Revenue objective run failed." }

& $venvPython "scripts/run_optimizer.py" "--client" "sample_enterprise" "--objective" "pipeline"
if ($LASTEXITCODE -ne 0) { throw "Sample client run failed." }

Write-Output "Bootstrap complete."
