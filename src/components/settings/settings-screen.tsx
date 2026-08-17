"use client";

import { useState } from "react";
import { Mail, Plus, Server, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProfileForm } from "@/components/settings/profile-form";
import type {
  EmailStatus,
  MemoryItem,
  ProfileFields,
  SendEmailMode,
} from "@/lib/types";

const SEND_MODE_COPY: Record<SendEmailMode, { label: string; tone: string }> = {
  none: {
    label: "Sending disabled",
    tone: "Emails are drafted and logged, never delivered.",
  },
  test: {
    label: "Test mode",
    tone: "Every email is redirected to the test inbox, real recipient preserved in the subject.",
  },
  send: {
    label: "Live sending",
    tone: "Emails go to real recipients.",
  },
};

function TransportRow({
  icon: Icon,
  name,
  active,
  ready,
  detail,
}: {
  icon: typeof Mail;
  name: string;
  active: boolean;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${
          ready ? "text-foreground" : "text-muted-foreground"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {name}
          {active && <Badge>in use</Badge>}
          {ready && !active && <Badge variant="secondary">ready</Badge>}
        </p>
        <p className="text-muted-foreground mt-0.5 break-words">{detail}</p>
      </div>
    </div>
  );
}

export function SettingsScreen({
  initialProfile,
  initialMemories,
  email,
  sendEmailMode,
}: {
  initialProfile: ProfileFields;
  initialMemories: MemoryItem[];
  email: EmailStatus;
  sendEmailMode: SendEmailMode;
}) {
  const [memories, setMemories] = useState(initialMemories);
  const [draftMemory, setDraftMemory] = useState("");

  async function handleAddMemory() {
    const content = draftMemory.trim();
    if (!content) return;
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      setMemories([(await res.json()) as MemoryItem, ...memories]);
      setDraftMemory("");
    }
  }

  async function handleDeleteMemory(id: string) {
    const previous = memories;
    setMemories(memories.filter((memory) => memory.id !== id));
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (!res.ok) setMemories(previous);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>
            Permanent details. The assistant reads these on every request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm initialProfile={initialProfile} />
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Email sending</CardTitle>
            <CardDescription>
              Two transports are supported. SMTP needs only environment
              variables; Gmail sends as you, so replies thread to your inbox.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TransportRow
              icon={Server}
              name="SMTP"
              active={email.resolved === "smtp"}
              ready={email.smtpConfigured}
              detail={
                email.smtpConfigured
                  ? `${email.smtpHost}, sending as ${email.smtpFrom}`
                  : "Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env.local."
              }
            />

            <TransportRow
              icon={Mail}
              name="Gmail (OAuth)"
              active={email.resolved === "gmail"}
              ready={email.googleConnected}
              detail={
                email.googleConnected
                  ? `Connected as ${email.googleEmail ?? "your Google account"}`
                  : email.googleOAuthConfigured
                    ? "Not connected."
                    : "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to enable this."
              }
            />

            {email.googleOAuthConfigured && (
              <Button
                variant={email.googleConnected ? "outline" : "default"}
                asChild
                className="w-full"
              >
                <a href="/api/integrations/google">
                  {email.googleConnected ? "Reconnect Google" : "Connect Google"}
                </a>
              </Button>
            )}

            <div className="bg-muted/50 space-y-1.5 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={sendEmailMode === "send" ? "default" : "secondary"}
                >
                  SEND_EMAIL={sendEmailMode}
                </Badge>
                <span className="font-medium">
                  {SEND_MODE_COPY[sendEmailMode].label}
                </span>
              </div>
              <p className="text-muted-foreground">
                {SEND_MODE_COPY[sendEmailMode].tone}
              </p>
              <p className="text-muted-foreground">
                {email.resolved === "none"
                  ? "No transport is ready, so sending would fail."
                  : `EMAIL_TRANSPORT=${email.transport} resolves to ${email.resolved}.`}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What it has learned</CardTitle>
            <CardDescription>
              Written automatically after runs. Delete anything that is wrong.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={draftMemory}
                placeholder="Add something it should always remember"
                onChange={(event) => setDraftMemory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddMemory();
                  }
                }}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleAddMemory}
                aria-label="Add memory"
              >
                <Plus className="size-4" />
              </Button>
            </div>

            {memories.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing yet. Facts appear here after the assistant completes work
                for you.
              </p>
            ) : (
              <ul className="space-y-2">
                {memories.map((memory) => (
                  <li
                    key={memory.id}
                    className="group flex items-start gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <Badge variant="secondary" className="mt-0.5 shrink-0">
                      {memory.category}
                    </Badge>
                    <span className="min-w-0 flex-1">{memory.content}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteMemory(memory.id)}
                      aria-label="Delete memory"
                      className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
