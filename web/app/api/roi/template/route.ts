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
      "Paid Search",
      85000,
      31000000,
      7600000,
      54000,
      114000,
      0.74,
    ],
  ];

  const instructionsRows = [
    ["Column", "Required", "What This Means", "Expected Format", "Example Value"],
    ...UPLOAD_TEMPLATE_COLUMNS.map((column) => [
      column.header,
      column.required ? "Yes" : "No (Optional)",
      column.description,
      column.type === "currency"
        ? "Currency (numbers only or with $)"
        : column.type === "number"
          ? "Number"
          : "Text",
      column.example,
    ]),
    [],
    [
      "How to use",
      "",
      "Fill one row per channel. Keep the headers exactly the same.",
      "",
      "",
    ],
    [
      "Tip",
      "",
      "All required fields must be present before upload. Optional beta can be blank.",
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
