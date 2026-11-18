import type { UIMessage } from "ai";
import type { EntitySummary } from "@/lib/types";

/**
 * Client-side export of found records to CSV or Excel. Nothing here touches the
 * server: the records are already in the chat's message history.
 */

export type ExportFormat = "csv" | "xlsx";

// Tool results that carry entity rows. enrichContact is included because it
// returns the same rows with a newly revealed email, which must win.
const ENTITY_TOOLS = new Set(["tool-saveEntities", "tool-enrichContact"]);

/**
 * Every record found in the conversation, deduplicated by id. Later results are
 * merged over earlier ones, so an enrichment pass fills in the email that the
 * original search lacked without discarding anything else.
 */
export function collectConversationEntities(
  messages: UIMessage[],
): EntitySummary[] {
  const byId = new Map<string, EntitySummary>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!ENTITY_TOOLS.has(part.type)) continue;
      const toolPart = part as { state?: string; output?: unknown };
      if (toolPart.state !== "output-available") continue;

      const entities = (toolPart.output as { entities?: unknown } | undefined)
        ?.entities;
      if (!Array.isArray(entities)) continue;

      for (const raw of entities as EntitySummary[]) {
        if (!raw?.id) continue;
        const previous = byId.get(raw.id);
        byId.set(raw.id, previous ? mergeEntity(previous, raw) : raw);
      }
    }
  }

  return [...byId.values()];
}

function mergeEntity(a: EntitySummary, b: EntitySummary): EntitySummary {
  return {
    ...a,
    ...Object.fromEntries(
      Object.entries(b).filter(([, value]) => value !== null && value !== undefined),
    ),
    attributes: { ...a.attributes, ...b.attributes },
    contacted: a.contacted || b.contacted,
  } as EntitySummary;
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(cellValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * The data comes from scraped web pages, so a value such as "=HYPERLINK(...)"
 * would run as a formula when a CSV is opened. Prefixing an apostrophe makes
 * the spreadsheet treat it as text. Not needed for .xlsx, where exceljs writes
 * strings as string cells, never formulas.
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Header plus rows. Fixed columns first, then every attribute key that has a
 * value anywhere in the set, most common first. Columns are derived from the
 * data because the entity shape is domain-agnostic.
 */
export function toTable(entities: EntitySummary[]): {
  header: string[];
  rows: string[][];
} {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    for (const [key, value] of Object.entries(entity.attributes ?? {})) {
      if (cellValue(value) === "") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const attributeKeys = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const header = [
    "Name",
    "Type",
    "Organisation",
    "Email",
    "LinkedIn",
    ...attributeKeys.map(humanize),
    "Source",
    "Contacted",
  ];

  const rows = entities.map((entity) =>
    [
      entity.name,
      entity.type,
      entity.organization,
      entity.email,
      entity.linkedinUrl,
      ...attributeKeys.map((key) => entity.attributes?.[key]),
      entity.sourceUrl,
      entity.contacted ? "Yes" : "No",
    ].map(cellValue),
  );

  return { header, rows };
}

function toCsv(header: string[], rows: string[][]): Blob {
  const escape = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [header, ...rows].map((row) =>
    row.map((value) => escape(neutralizeFormula(value))).join(","),
  );
  // The BOM makes Excel open the file as UTF-8 instead of mangling non-ASCII names.
  return new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
}

async function toXlsx(header: string[], rows: string[][]): Promise<Blob> {
  // Loaded on demand so exceljs stays out of the chat bundle.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Results");

  sheet.addRow(header).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  sheet.columns.forEach((column, index) => {
    const longest = Math.max(
      header[index].length,
      ...rows.map((row) => row[index]?.length ?? 0),
    );
    column.width = Math.min(Math.max(longest + 2, 10), 50);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function downloadEntities(
  entities: EntitySummary[],
  format: ExportFormat,
): Promise<void> {
  const { header, rows } = toTable(entities);
  const blob =
    format === "csv" ? toCsv(header, rows) : await toXlsx(header, rows);

  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `results-${date}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick; some browsers cancel the download if revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
