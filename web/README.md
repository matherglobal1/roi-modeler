# ROI Modeller Web Dashboard

Next.js dashboard for the ROI optimizer backend.

## Local development

```powershell
cd C:\Users\WillMather\Documents\JG\Projects\apps-internal\roi-modeler\web
npm install
npm run dev
```

Open http://localhost:3000.

## Data loading behavior

At runtime, the app loads the latest scenario files from:

- `../data/canonical/outputs/*_summary_*.json`
- `../data/canonical/outputs/*_recommendation_*.csv`

When those files are not present (for example in fresh deploys), it serves `data/demo-snapshot.json`.

API route:

- `GET /api/roi/latest`
- `POST /api/roi/run`
- `GET /api/roi/template`

Upload route:

- `GET /upload-data` for 3-step flow: download template, upload file, review and run.

## Vercel

- Set project root directory to `web`.
- Framework preset: Next.js.
- Build command: `npm run build` (default).
- Install command: `npm install` (default).
