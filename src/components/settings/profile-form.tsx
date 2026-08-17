"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  REQUIRED_PROFILE_FIELDS,
  isProfileComplete,
  type ProfileFields,
} from "@/lib/types";

type ProfileFieldSpec = {
  key: keyof ProfileFields;
  label: string;
  placeholder: string;
  multiline?: boolean;
};

// Deliberately domain-agnostic: nothing here assumes the user is doing sales.
// One list, shared by Settings and onboarding, so the two cannot drift apart.
const FIELDS: ProfileFieldSpec[] = [
  { key: "displayName", label: "Your name", placeholder: "Rajeshwar" },
  { key: "role", label: "Role", placeholder: "Founder" },
  { key: "company", label: "Company", placeholder: "Acme Advisory" },
  { key: "location", label: "Location", placeholder: "Bangalore, India" },
  { key: "timezone", label: "Timezone", placeholder: "Asia/Kolkata" },
  {
    key: "sendingEmail",
    label: "Send email from",
    placeholder: "you@company.com",
  },
  {
    key: "calendarLink",
    label: "Calendar link",
    placeholder: "https://cal.com/you",
  },
  {
    key: "writingTone",
    label: "Preferred tone",
    placeholder: "Direct, warm, no corporate filler",
  },
  {
    key: "emailSignature",
    label: "Email signature",
    placeholder: "Rajeshwar\nAcme Advisory",
    multiline: true,
  },
  {
    key: "about",
    label: "About you",
    placeholder:
      "What you do, who you help, and anything the assistant should always keep in mind.",
    multiline: true,
  },
];

const REQUIRED = new Set<keyof ProfileFields>(REQUIRED_PROFILE_FIELDS);

export function ProfileForm({
  initialProfile,
  submitLabel = "Save profile",
  requireComplete = false,
  onSaved,
}: {
  initialProfile: ProfileFields;
  submitLabel?: string;
  /** Onboarding blocks submission until the required fields are filled. */
  requireComplete?: boolean;
  onSaved?: (profile: ProfileFields) => void;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = isProfileComplete(profile);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        setError("Could not save your profile. Try again.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.(profile);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {FIELDS.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={field.key}>
            {field.label}
            {requireComplete && REQUIRED.has(field.key) && (
              <span className="text-muted-foreground ml-1">*</span>
            )}
          </Label>
          {field.multiline ? (
            <Textarea
              id={field.key}
              rows={3}
              value={profile[field.key]}
              placeholder={field.placeholder}
              onChange={(event) =>
                setProfile({ ...profile, [field.key]: event.target.value })
              }
            />
          ) : (
            <Input
              id={field.key}
              value={profile[field.key]}
              placeholder={field.placeholder}
              onChange={(event) =>
                setProfile({ ...profile, [field.key]: event.target.value })
              }
            />
          )}
        </div>
      ))}

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <Button
          onClick={handleSave}
          disabled={saving || (requireComplete && !complete)}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
        {saved && !requireComplete && (
          <span className="text-muted-foreground flex items-center gap-1 text-sm">
            <Check className="size-4" />
            Saved
          </span>
        )}
        {requireComplete && !complete && (
          <span className="text-muted-foreground text-sm">
            Fill the fields marked * to continue.
          </span>
        )}
      </div>
    </div>
  );
}
