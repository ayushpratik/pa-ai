"use client";

import { CheckCircle2, Link2, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
        <p className="text-muted-foreground text-xs">Saved and deduplicated</p>
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
