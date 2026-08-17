"use client";

import { useState } from "react";
import { Check, CircleDollarSign, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlanStatus, PlanSummary } from "@/lib/types";

const STATUS_LABEL: Record<PlanStatus, string> = {
  proposed: "Awaiting your approval",
  approved: "Approved",
  running: "Running",
  done: "Completed",
  cancelled: "Cancelled",
  blocked: "Blocked",
};

export function PlanCard({
  plan,
  onApproved,
  onCancelled,
}: {
  plan: PlanSummary;
  onApproved: () => void;
  onCancelled: () => void;
}) {
  // The tool result is frozen in the message history, so the card tracks the
  // live status locally after the user acts on it.
  const [status, setStatus] = useState<PlanStatus>(plan.status);
  const [pending, setPending] = useState<PlanStatus | null>(null);

  async function transition(next: "approved" | "cancelled") {
    setPending(next);
    try {
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) return;

      setStatus(next);
      if (next === "approved") onApproved();
      else onCancelled();
    } finally {
      setPending(null);
    }
  }

  const isOpen = status === "proposed";

  return (
    <div className="bg-card w-full rounded-xl border p-4 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Plan
          </p>
          <p className="mt-1 font-medium">{plan.goal}</p>
        </div>
        <Badge variant={isOpen ? "default" : "secondary"} className="shrink-0">
          {STATUS_LABEL[status]}
        </Badge>
      </div>

      <ol className="mt-4 space-y-2.5">
        {plan.steps.map((step, index) => (
          <li key={index} className="flex gap-3">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                status === "done"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 font-medium">
                {step.title}
                {step.costly && (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">
                    <CircleDollarSign className="size-3" />
                    costs credits
                  </span>
                )}
              </p>
              {step.detail && (
                <p className="text-muted-foreground mt-0.5">{step.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {isOpen && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => transition("approved")}
            disabled={pending !== null}
            className="gap-1.5"
          >
            {pending === "approved" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Approve and run
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => transition("cancelled")}
            disabled={pending !== null}
            className="gap-1.5"
          >
            <X className="size-3.5" />
            Cancel
          </Button>
          <span className="text-muted-foreground text-xs">
            Or just tell me what to change.
          </span>
        </div>
      )}
    </div>
  );
}
