"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./upload-data.module.css";

type PreviewData = {
  headers: string[];
  rows: string[][];
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

async function buildPreview(file: File): Promise<PreviewData> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return { headers: [], rows: [] };
    }
    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1, 11).map((line) => parseCsvLine(line));
    return { headers, rows };
  }

  const arrayBuffer = await file.arrayBuffer();
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(arrayBuffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<(string | number | boolean | null)[]>(firstSheet, {
    header: 1,
    blankrows: false,
  });
  if (!rows.length) {
    return { headers: [], rows: [] };
  }
  const headers = (rows[0] ?? []).map((cell) => String(cell ?? "").trim());
  const previewRows = rows.slice(1, 11).map((row) => headers.map((_, index) => String(row[index] ?? "")));
  return { headers, rows: previewRows };
}

function labelFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function UploadDataPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [clientLabel, setClientLabel] = useState("");
  const [preview, setPreview] = useState<PreviewData>({ headers: [], rows: [] });
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleSelectedFile(nextFile: File) {
    const lower = nextFile.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      setError("Please upload an .xlsx or .csv file.");
      return;
    }

    setError("");
    setStatus("");
    setIsParsing(true);

    try {
      const data = await buildPreview(nextFile);
      setFile(nextFile);
      setPreview(data);
      setClientLabel(labelFromFile(nextFile.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview this file.");
    } finally {
      setIsParsing(false);
    }
  }

  async function runModel() {
    if (!file) {
      setError("Upload a file first.");
      return;
    }

    setIsRunning(true);
    setError("");
    setStatus("Running model. This can take up to a minute.");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("clientLabel", clientLabel);

      const response = await fetch("/api/roi/run", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        clientId?: string;
      };

      if (!response.ok || !payload.success || !payload.clientId) {
        throw new Error(payload.error || "Model run failed.");
      }

      router.push(`/?client=${encodeURIComponent(payload.clientId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model run failed.");
      setStatus("");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.header}>
        <p className={styles.kicker}>Strategy Upload Flow</p>
        <h1>Upload Data</h1>
        <p>
          Drag a file, verify the preview, then run the model. No config screens and no JSON required.
        </p>
      </section>

      <section
        className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) {
            void handleSelectedFile(dropped);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv"
          className={styles.fileInput}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) {
              void handleSelectedFile(selected);
            }
          }}
        />
        <h2>Drop your .xlsx or .csv file here</h2>
        <p>or</p>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Choose File
        </button>
      </section>

      <section className={styles.card}>
        <div className={styles.row}>
          <label>
            <span>Client Name</span>
            <input
              value={clientLabel}
              onChange={(event) => setClientLabel(event.target.value)}
              placeholder="Example: Q2 EMEA Forecast"
            />
          </label>
          <button type="button" onClick={() => void runModel()} disabled={!file || isRunning || isParsing}>
            {isRunning ? "Running..." : "Run Model"}
          </button>
        </div>
        {status && <p className={styles.status}>{status}</p>}
        {error && <p className={styles.error}>{error}</p>}
      </section>

      <section className={styles.card}>
        <h3>Preview</h3>
        {isParsing && <p>Parsing file...</p>}
        {!isParsing && !preview.headers.length && (
          <p className={styles.muted}>Upload a file to preview parsed data before running the model.</p>
        )}
        {!!preview.headers.length && (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  {preview.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  <tr key={`${rowIndex}-${row.join("|")}`}>
                    {preview.headers.map((header, colIndex) => (
                      <td key={`${header}-${colIndex}`}>{row[colIndex] || "-"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
