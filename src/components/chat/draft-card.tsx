"use client";

import { useState } from "react";
import { Check, Copy, Link2, Mail, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OutreachDraft } from "@/lib/types";

function DraftRow({ draft }: { draft: OutreachDraft }) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  async function persist() {
    setEditing(false);
    await fetch(`/api/outreach/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subject || null, body }),
    });
  }

  async function copy() {
    // The delivery path for LinkedIn: this app cannot send those itself.
    const text = subject ? `${subject}\n\n${body}` : body;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isEmail = draft.channel === "email";

  return (
    <div className="border-t p-4 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isEmail ? (
            <Mail className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <Link2 className="text-muted-foreground size-4 shrink-0" />
          )}
          <span className="truncate font-medium">{draft.entityName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {draft.status !== "drafted" && (
            <Badge variant="secondary">{draft.status}</Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (editing ? persist() : setEditing(true))}
            className="gap-1.5"
          >
            {editing ? (
              <Check className="size-3.5" />
            ) : (
              <Pencil className="size-3.5" />
            )}
            {editing ? "Done" : "Edit"}
          </Button>
          <Button size="sm" variant="ghost" onClick={copy} className="gap-1.5">
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            Copy
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {isEmail &&
          (editing ? (
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
            />
          ) : (
            subject && <p className="font-medium">{subject}</p>
          ))}

        {editing ? (
          <Textarea
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        ) : (
          <p className="text-muted-foreground whitespace-pre-wrap">{body}</p>
        )}
      </div>
    </div>
  );
}

export function DraftList({
  drafts,
  note,
}: {
  drafts: OutreachDraft[];
  note?: string;
}) {
  if (drafts.length === 0) {
    return <p className="text-muted-foreground text-sm">No drafts written.</p>;
  }

  const hasLinkedIn = drafts.some((draft) => draft.channel === "linkedin");

  return (
    <div className="bg-card w-full rounded-xl border text-sm shadow-sm">
      <div className="border-b px-4 py-2.5">
        <p className="font-medium">
          {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}
        </p>
        {hasLinkedIn && note && (
          <p className="text-muted-foreground mt-0.5 text-xs">{note}</p>
        )}
      </div>
      {drafts.map((draft) => (
        <DraftRow key={draft.id} draft={draft} />
      ))}
    </div>
  );
}
