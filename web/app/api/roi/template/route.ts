import * as XLSX from "xlsx";

import { UPLOAD_TEMPLATE_COLUMNS } from "@/lib/upload-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const workbook = XLSX.utils.book_new();

  const dataSheetRows = [
    UPLOAD_TEMPLATE_COLUMNS.map((column) => column.header),
    [
      "Acme Software",
      "January 2026",
      "Paid Search",
      15000,
      6200000,
      1250000,
    ],
    ["Acme Software", "January 2026", "Paid Social", 12000, 4300000, 920000],
    ["Acme Software", "February 2026", "Paid Search", 16500, 6500000, 1320000],
  ];

  const instructionsRows = [
    ["Column", "Required", "What This Means", "Expected Format", "Example Value"],
    ...UPLOAD_TEMPLATE_COLUMNS.map((column) => [
      column.header,
      column.required ? "Yes" : "No (Optional)",
      column.description,
      column.type === "currency"
        ? "Currency (numbers only or with $)"
        : column.type === "month"
          ? "Month text (January 2026) or YYYY-MM"
        : column.type === "number"
          ? "Number"
          : "Text",
      column.example,
    ]),
    [],
    [
      "How to use",
      "",
      "Enter one row per channel per month. Keep the headers exactly the same.",
      "",
      "",
    ],
    [
      "Tip",
      "",
      "The model will aggregate totals and show month-over-month trends.",
      "",
      "",
    ],
  ];

  const dataSheet = XLSX.utils.aoa_to_sheet(dataSheetRows);
  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsRows);

  XLSX.utils.book_append_sheet(workbook, dataSheet, "Client Data Template");
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="roi-modeller-upload-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
