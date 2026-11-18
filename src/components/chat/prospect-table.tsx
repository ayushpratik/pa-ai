"use client";

import { useState } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  Mail,
} from "lucide-react";
import { useConversationEntities } from "@/components/chat/conversation-entities";
import { Badge } from "@/components/ui/badge";
import { downloadEntities, type ExportFormat } from "@/lib/export";
import type { EntitySummary } from "@/lib/types";

/**
 * Picks the most informative attribute keys across the result set. The entity
 * shape is intentionally open, so the columns are derived from the data rather
 * than hard-coded to any one domain.
 */
function deriveColumns(entities: EntitySummary[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    for (const [key, value] of Object.entries(entity.attributes ?? {})) {
      if (value === null || value === undefined || value === "") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([key]) => key);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

/**
 * Downloads every record found in the conversation, not just this table's
 * batch, so a search saved in several batches still exports as one file. Falls
 * back to this table's rows if rendered outside the conversation provider.
 */
function ExportChips({ fallback }: { fallback: EntitySummary[] }) {
  const all = useConversationEntities();
  const entities = all && all.length > 0 ? all : fallback;
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(format: ExportFormat) {
    setPending(format);
    setFailed(false);
    try {
      await downloadEntities(entities, format);
    } catch (error) {
      console.error("Export failed", error);
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  const chips: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
    { format: "xlsx", label: "Excel", icon: FileSpreadsheet },
    { format: "csv", label: "CSV", icon: FileText },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {failed && (
        <span className="text-destructive text-xs">Export failed</span>
      )}
      <span className="text-muted-foreground hidden text-xs sm:inline">
        Export {entities.length}:
      </span>
      {chips.map(({ format, label, icon: Icon }) => (
        <button
          key={format}
          type="button"
          onClick={() => run(format)}
          disabled={pending !== null}
          title={`Download all ${entities.length} results as ${label}`}
          className="hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {pending === format ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Icon className="size-3" />
          )}
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProspectTable({ entities }: { entities: EntitySummary[] }) {
  if (entities.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Nothing matched.</p>
    );
  }

  const columns = deriveColumns(entities);

  return (
    <div className="bg-card w-full rounded-xl border text-sm shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <p className="font-medium">
          {entities.length} {entities.length === 1 ? "record" : "records"}
        </p>
        <ExportChips fallback={entities} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Organisation</th>
              {columns.map((column) => (
                <th key={column} className="px-4 py-2 font-medium">
                  {humanize(column)}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Contact</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id} className="border-t align-top">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{entity.name}</span>
                  {entity.contacted && (
                    <Badge variant="secondary" className="ml-2 gap-1">
                      <CheckCircle2 className="size-3" />
                      contacted
                    </Badge>
                  )}
                  {entity.sourceUrl && (
                    <a
                      href={entity.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground mt-0.5 block truncate text-xs underline-offset-2 hover:underline"
                    >
                      source
                    </a>
                  )}
                </td>
                <td className="text-muted-foreground px-4 py-2.5">
                  {entity.organization ?? "—"}
                </td>
                {columns.map((column) => (
                  <td
                    key={column}
                    className="text-muted-foreground max-w-[16rem] px-4 py-2.5"
                  >
                    {formatValue(entity.attributes?.[column]) || "—"}
                  </td>
                ))}
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {entity.email ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs"
                        title={entity.email}
                      >
                        <Mail className="size-3.5" />
                        email
                      </span>
                    ) : null}
                    {entity.linkedinUrl ? (
                      <a
                        href={entity.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                      >
                        <Link2 className="size-3.5" />
                        profile
                      </a>
                    ) : null}
                    {!entity.email && !entity.linkedinUrl && (
                      <span className="text-muted-foreground text-xs">none</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
