export type ColumnType = "text" | "currency" | "number";

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
    header: "Channel",
    required: true,
    type: "text",
    description: "Marketing channel name exactly as your team uses it.",
    example: "Paid Search",
  },
  {
    header: "Monthly Budget",
    required: true,
    type: "currency",
    description: "Monthly budget allocated to this channel in USD.",
    example: "$85000",
  },
  {
    header: "Projected Pipeline",
    required: true,
    type: "currency",
    description: "Expected sourced pipeline for this channel.",
    example: "$31000000",
  },
  {
    header: "Projected Revenue",
    required: true,
    type: "currency",
    description: "Expected sourced revenue for this channel.",
    example: "$7600000",
  },
  {
    header: "Projected HQLs",
    required: true,
    type: "number",
    description: "Expected number of high-quality leads from this channel.",
    example: "54000",
  },
  {
    header: "Projected Leads",
    required: true,
    type: "number",
    description: "Expected total leads for this channel.",
    example: "114000",
  },
  {
    header: "Diminishing Returns Beta (Optional)",
    required: false,
    type: "number",
    description:
      "Optional curve setting. Leave blank to use the default model value.",
    example: "0.74",
  },
];

export const REQUIRED_TEMPLATE_HEADERS = UPLOAD_TEMPLATE_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.header);
