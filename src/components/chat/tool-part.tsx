"use client";

import {
  AlertTriangle,
  Check,
  Database,
  FileText,
  Globe,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import { DraftList } from "@/components/chat/draft-card";
import { PlanCard } from "@/components/chat/plan-card";
import { ProspectTable } from "@/components/chat/prospect-table";
import type {
  EntitySummary,
  OutreachDraft,
  PlanSummary,
} from "@/lib/types";

/**
 * The AI SDK types tool parts generically. Rather than thread generics through
 * the whole tree for a handful of known tools, this narrows at the render site.
 */
type ToolPart = {
  type: string;
  state?: string;
  output?: unknown;
  errorText?: string;
};

const TOOL_LABELS: Record<string, { label: string; icon: typeof Globe }> = {
  searchWeb: { label: "Searching the web", icon: Globe },
  fetchPage: { label: "Reading a page", icon: FileText },
  extractEntities: { label: "Extracting details", icon: Sparkles },
  searchApollo: { label: "Searching Apollo", icon: Database },
  enrichContact: { label: "Finding contact details", icon: Database },
  listEntities: { label: "Checking what you already have", icon: Database },
  sendEmail: { label: "Sending email", icon: Send },
  proposePlan: { label: "Drafting a plan", icon: Sparkles },
  updatePlanStatus: { label: "Updating the plan", icon: Check },
  saveEntities: { label: "Saving results", icon: Database },
  draftOutreach: { label: "Writing drafts", icon: FileText },
};

function toolName(type: string): string {
  return type.startsWith("tool-") ? type.slice("tool-".length) : type;
}

/** One-line summary for tools whose full output would just be noise. */
function summarize(name: string, output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const data = output as Record<string, unknown>;

  if (typeof data.error === "string") return data.error;

  switch (name) {
    case "searchWeb":
      return Array.isArray(data.results)
        ? `${data.results.length} results`
        : null;
    case "fetchPage":
      return typeof data.url === "string" ? new URL(data.url).hostname : null;
    case "extractEntities":
      return Array.isArray(data.entities)
        ? `${data.entities.length} found`
        : null;
    case "searchApollo":
    case "listEntities":
      return typeof data.count === "number" ? `${data.count} found` : null;
    case "enrichContact":
      return Array.isArray(data.entities)
        ? `${data.entities.length} looked up`
        : null;
    case "sendEmail": {
      if (!Array.isArray(data.results)) return null;
      const sent = data.results.filter(
        (result) => (result as { sent?: boolean }).sent,
      ).length;
      return `${sent} of ${data.results.length} sent (mode: ${String(data.mode)})`;
    }
    default:
      return null;
  }
}

function CompactRow({
  name,
  detail,
  running,
  failed,
}: {
  name: string;
  detail: string | null;
  running: boolean;
  failed: boolean;
}) {
  const spec = TOOL_LABELS[name];
  const Icon = failed ? AlertTriangle : (spec?.icon ?? Sparkles);

  return (
    <div
      className={`flex items-center gap-2 text-xs ${
        failed ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {running ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Icon className="size-3.5 shrink-0" />
      )}
      <span>{spec?.label ?? name}</span>
      {detail && (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">{detail}</span>
        </>
      )}
    </div>
  );
}

export function ToolPart({
  part,
  onResume,
}: {
  part: ToolPart;
  onResume: (text: string) => void;
}) {
  const name = toolName(part.type);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";

  if (failed) {
    return (
      <CompactRow
        name={name}
        detail={part.errorText ?? "failed"}
        running={false}
        failed
      />
    );
  }

  if (running || part.state !== "output-available") {
    return <CompactRow name={name} detail={null} running failed={false} />;
  }

  const output = part.output as Record<string, unknown> | undefined;

  // The gate returns a normal result rather than throwing, so surface it quietly
  // and let the model recover by proposing a plan.
  if (output && output.blocked === true) {
    return (
      <CompactRow
        name={name}
        detail="waiting for an approved plan"
        running={false}
        failed={false}
      />
    );
  }

  if (name === "proposePlan" && output && "steps" in output) {
    return (
      <PlanCard
        plan={output as unknown as PlanSummary}
        onApproved={() =>
          onResume("Approved. Go ahead and run the plan.")
        }
        onCancelled={() => onResume("I've cancelled that plan.")}
      />
    );
  }

  if (name === "saveEntities" && output && Array.isArray(output.entities)) {
    return <ProspectTable entities={output.entities as EntitySummary[]} />;
  }

  if (name === "draftOutreach" && output && Array.isArray(output.drafts)) {
    return (
      <DraftList
        drafts={output.drafts as OutreachDraft[]}
        note={typeof output.note === "string" ? output.note : undefined}
      />
    );
  }

  return (
    <CompactRow
      name={name}
      detail={summarize(name, output)}
      running={false}
      failed={false}
    />
  );
}
