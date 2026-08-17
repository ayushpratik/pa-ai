import "server-only";
import { env } from "@/lib/env";
import type { EntityInput } from "@/lib/entities";

const BASE_URL = "https://api.apollo.io/api/v1";

type ApolloPerson = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  country?: string | null;
  organization?: { name?: string; website_url?: string; industry?: string } | null;
};

async function apolloRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const key = env.apolloApiKey;
  if (!key) throw new Error("Apollo is not configured (APOLLO_API_KEY missing).");

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": key,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Apollo request failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return (await response.json()) as T;
}

function toEntityInput(person: ApolloPerson): EntityInput {
  const name =
    person.name ??
    [person.first_name, person.last_name].filter(Boolean).join(" ").trim();

  return {
    type: "person",
    name,
    organization: person.organization?.name ?? null,
    // Apollo returns the "email_not_unlocked@domain.com" placeholder until a
    // credit is spent, so treat that as no email at all.
    email:
      person.email && !person.email.includes("email_not_unlocked")
        ? person.email
        : null,
    linkedinUrl: person.linkedin_url ?? null,
    attributes: {
      title: person.title ?? null,
      location: [person.city, person.country].filter(Boolean).join(", ") || null,
      industry: person.organization?.industry ?? null,
      website: person.organization?.website_url ?? null,
      apolloId: person.id ?? null,
    },
    source: "apollo",
  };
}

export async function apolloSearchPeople(params: {
  titles?: string[];
  locations?: string[];
  keywords?: string;
  organizationNames?: string[];
  limit: number;
}): Promise<EntityInput[]> {
  const data = await apolloRequest<{ people?: ApolloPerson[]; contacts?: ApolloPerson[] }>(
    "/mixed_people/search",
    {
      person_titles: params.titles,
      person_locations: params.locations,
      q_organization_name: params.organizationNames?.join(" "),
      q_keywords: params.keywords,
      page: 1,
      per_page: Math.min(params.limit, 25),
    },
  );

  const people = [...(data.people ?? []), ...(data.contacts ?? [])];
  return people.slice(0, params.limit).map(toEntityInput);
}

/**
 * Spends an Apollo credit to reveal a verified email. Callers must have already
 * checked for an approved plan.
 */
export async function apolloEnrich(params: {
  name?: string;
  organization?: string | null;
  linkedinUrl?: string | null;
}): Promise<{ email: string | null; linkedinUrl: string | null }> {
  const data = await apolloRequest<{ person?: ApolloPerson }>("/people/match", {
    name: params.name,
    organization_name: params.organization ?? undefined,
    linkedin_url: params.linkedinUrl ?? undefined,
    reveal_personal_emails: true,
  });

  const person = data.person;
  const email =
    person?.email && !person.email.includes("email_not_unlocked")
      ? person.email
      : null;

  return { email, linkedinUrl: person?.linkedin_url ?? null };
}
