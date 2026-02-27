export type ColumnType = "text" | "currency" | "number" | "month";

export type UploadTemplateColumn = {
  header: string;
  required: boolean;
  type: ColumnType;
  description: string;
  example: string;
};

export const UPLOAD_TEMPLATE_COLUMNS: UploadTemplateColumn[] = [
  {
    header: "Client Name",
    required: true,
    type: "text",
    description: "Name of the client for this scenario.",
    example: "Acme Software",
  },
  {
    header: "Time Period (Month)",
    required: true,
    type: "month",
    description: "Month for this channel row (for example: January 2026).",
    example: "January 2026",
  },
  {
    header: "Channel",
    required: true,
    type: "text",
    description: "Marketing channel name exactly as your team uses it.",
    example: "Paid Search",
  },
  {
    header: "Budget",
    required: true,
    type: "currency",
    description: "Budget for this channel in the selected month, in USD.",
    example: "$15000",
  },
  {
    header: "Expected Pipeline",
    required: true,
    type: "currency",
    description: "Expected sourced pipeline for this channel and month.",
    example: "$6200000",
  },
  {
    header: "Expected Revenue",
    required: true,
    type: "currency",
    description: "Expected sourced revenue for this channel and month.",
    example: "$1250000",
  },
];

export const REQUIRED_TEMPLATE_HEADERS = UPLOAD_TEMPLATE_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.header);
