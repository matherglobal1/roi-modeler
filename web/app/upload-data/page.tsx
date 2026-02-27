"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  REQUIRED_TEMPLATE_HEADERS,
  UPLOAD_TEMPLATE_COLUMNS,
} from "@/lib/upload-template";
import styles from "./upload-data.module.css";

type PreviewData = {
  headers: string[];
  rows: string[][];
};

type CellIssue = {
  rowIndex: number;
  colIndex: number;
  message: string;
};

type ColumnValidation = {
  header: string;
  valid: boolean;
  missing: boolean;
  message: string;
};

type ValidationResult = {
  columnChecks: ColumnValidation[];
  cellIssues: CellIssue[];
  missingRequiredColumns: string[];
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

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned.length) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseMonth(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const ymMatch = value.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    const month = Number(ymMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${ymMatch[1]}-${ymMatch[2]}`;
    }
    return null;
  }
  const parsed = new Date(`${value} 1`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const month = parsed.getMonth() + 1;
  return `${parsed.getFullYear()}-${month < 10 ? `0${month}` : month}`;
}

function normalizeHeader(text: string): string {
  return text.trim();
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
    const headers = parseCsvLine(lines[0]).map(normalizeHeader);
    const rows = lines.slice(1, 31).map((line) => parseCsvLine(line));
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
  const headers = (rows[0] ?? []).map((cell) => normalizeHeader(String(cell ?? "")));
  const previewRows = rows.slice(1, 31).map((row) => headers.map((_, index) => String(row[index] ?? "")));
  return { headers, rows: previewRows };
}

function validatePreview(preview: PreviewData): ValidationResult {
  const headerIndex = new Map<string, number>();
  preview.headers.forEach((header, index) => {
    headerIndex.set(normalizeHeader(header), index);
  });

  const missingRequiredColumns = REQUIRED_TEMPLATE_HEADERS.filter(
    (required) => !headerIndex.has(normalizeHeader(required)),
  );

  const cellIssues: CellIssue[] = [];
  const columnChecks: ColumnValidation[] = UPLOAD_TEMPLATE_COLUMNS.map((column) => {
    const idx = headerIndex.get(normalizeHeader(column.header));
    if (idx === undefined) {
      if (column.required) {
        return {
          header: column.header,
          valid: false,
          missing: true,
          message: "Missing required column",
        };
      }
      return {
        header: column.header,
        valid: true,
        missing: true,
        message: "Optional column not provided",
      };
    }

    let hasIssue = false;
    preview.rows.forEach((row, rowIndex) => {
      const value = String(row[idx] ?? "").trim();
      const isEmpty = value.length === 0;

      if (column.required && isEmpty) {
        hasIssue = true;
        cellIssues.push({
          rowIndex,
          colIndex: idx,
          message: `${column.header} is required.`,
        });
        return;
      }

      if (isEmpty) {
        return;
      }

      if (column.type === "currency" || column.type === "number") {
        const parsed = parseNumber(value);
        if (parsed === null) {
          hasIssue = true;
          cellIssues.push({
            rowIndex,
            colIndex: idx,
            message: `${column.header} must be a number.`,
          });
        }
      }

      if (column.type === "month") {
        const parsedMonth = parseMonth(value);
        if (!parsedMonth) {
          hasIssue = true;
          cellIssues.push({
            rowIndex,
            colIndex: idx,
            message: `${column.header} must look like 'January 2026' or '2026-01'.`,
          });
        }
      }
    });

    return {
      header: column.header,
      valid: !hasIssue,
      missing: false,
      message: hasIssue ? "Has data issues" : "Valid",
    };
  });

  return { columnChecks, cellIssues, missingRequiredColumns };
}

function firstClientName(preview: PreviewData): string {
  const idx = preview.headers.findIndex((header) => header === "Client Name");
  if (idx === -1) {
    return "";
  }
  for (const row of preview.rows) {
    const value = String(row[idx] ?? "").trim();
    if (value.length > 0) {
      return value;
    }
  }
  return "";
}

function fileNameToLabel(fileName: string): string {
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
  const [columnChecks, setColumnChecks] = useState<ColumnValidation[]>([]);
  const [cellIssues, setCellIssues] = useState<CellIssue[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const issueMap = new Map<string, string>(
    cellIssues.map((issue) => [`${issue.rowIndex}:${issue.colIndex}`, issue.message]),
  );

  const isValid =
    file !== null &&
    preview.headers.length > 0 &&
    columnChecks.filter((check) => !check.missing).every((check) => check.valid) &&
    cellIssues.length === 0;

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
      const parsedPreview = await buildPreview(nextFile);
      const validation = validatePreview(parsedPreview);

      setFile(nextFile);
      setPreview(parsedPreview);
      setColumnChecks(validation.columnChecks);
      setCellIssues(validation.cellIssues);
      setClientLabel(
        firstClientName(parsedPreview) || fileNameToLabel(nextFile.name),
      );

      if (validation.missingRequiredColumns.length > 0) {
        setError(
          `Missing column: ${validation.missingRequiredColumns[0]}. Download the template to see the required format.`,
        );
      } else if (validation.cellIssues.length > 0) {
        setError(
          "Some values need attention. Red cells show what to fix before running the model.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview this file.");
    } finally {
      setIsParsing(false);
    }
  }

  async function runModel() {
    if (!file || !isValid) {
      setError("Please fix the validation issues before running the model.");
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
      <section className={styles.stepCard}>
        <div className={styles.stepHeader}>
          <h2>Step 1: Download the template</h2>
          <button
            type="button"
            className={styles.helpLink}
            onClick={() => setHelpOpen(true)}
          >
            Need help?
          </button>
        </div>
        <p>
          Fill in your client&apos;s data using this template. All fields are required unless marked optional.
        </p>
        <a href="/api/roi/template" className={styles.primaryButton}>
          Download Template
        </a>
      </section>

      <section className={styles.stepCard}>
        <h2>Step 2: Upload your completed file</h2>
        <div
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
          <h3>Drop your .xlsx or .csv file here</h3>
          <p>or</p>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Choose File
          </button>
        </div>
      </section>

      <section className={styles.stepCard}>
        <h2>Step 3: Review and run</h2>
        <div className={styles.clientRow}>
          <label>
            <span>Client Name</span>
            <input
              value={clientLabel}
              onChange={(event) => setClientLabel(event.target.value)}
              placeholder="Example: Acme Q3 Plan"
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!isValid || isRunning || isParsing}
            onClick={() => void runModel()}
          >
            {isRunning ? "Running..." : "Run Model"}
          </button>
        </div>

        {!!columnChecks.length && (
          <ul className={styles.columnChecks}>
            {columnChecks.map((check) => (
              <li key={check.header} className={check.valid ? styles.columnOk : styles.columnIssue}>
                <span>{check.valid ? "✓" : "!"}</span>
                <div>
                  <strong>{check.header}</strong>
                  <p>{check.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {status && <p className={styles.status}>{status}</p>}
        {error && <p className={styles.error}>{error}</p>}
        {isParsing && <p className={styles.muted}>Validating your file...</p>}

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
                    {preview.headers.map((header, colIndex) => {
                      const issue = issueMap.get(`${rowIndex}:${colIndex}`);
                      return (
                        <td
                          key={`${header}-${colIndex}`}
                          className={issue ? styles.invalidCell : ""}
                          title={issue || ""}
                        >
                          {row[colIndex] || "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {helpOpen && (
        <div className={styles.modalBackdrop} onClick={() => setHelpOpen(false)}>
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>How to fill the template</h3>
              <button type="button" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
            <p>
              1. Download the template. 2. Enter one row per channel per month. 3. Keep the column names unchanged. 4. Upload
              and run.
            </p>
            <div className={styles.modalImages}>
              <Image
                src="/template-screenshot-1.svg"
                alt="Template screenshot showing required columns"
                width={720}
                height={260}
              />
              <Image
                src="/template-screenshot-2.svg"
                alt="Template screenshot showing a correctly filled sample row"
                width={720}
                height={260}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
