/**
 * Verifies that GEMINI_MODEL exists on the live API and supports generateContent.
 * Model ids change between Gemini releases, so confirm rather than assume.
 *
 * Run: npm run check:model
 */

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const wanted = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

if (!apiKey) {
  console.error("GOOGLE_GENERATIVE_AI_API_KEY is not set in .env.local");
  process.exit(1);
}

const res = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
  { headers: { "x-goog-api-key": apiKey } },
);

if (!res.ok) {
  console.error(`models.list failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const { models = [] } = await res.json();
const generateCapable = models.filter((m) =>
  (m.supportedGenerationMethods ?? []).includes("generateContent"),
);
const names = generateCapable.map((m) => m.name.replace(/^models\//, ""));

console.log("Flash / Flash-Lite models supporting generateContent:");
for (const n of names.filter((n) => n.includes("flash"))) {
  console.log(`  ${n}${n === wanted ? "   <-- GEMINI_MODEL" : ""}`);
}

if (names.includes(wanted)) {
  console.log(`\nOK: "${wanted}" is available.`);
} else {
  console.error(`\nFAIL: "${wanted}" is not in the list above. Update GEMINI_MODEL in .env.local.`);
  process.exit(1);
}
