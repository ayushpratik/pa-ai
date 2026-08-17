import { buildConsentUrl } from "@/lib/gmail";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

// Connecting a sending account is a per-user action, so it requires a session
// even though the consent URL itself carries no user context.
export const GET = withUser(async () => {
  try {
    return Response.redirect(buildConsentUrl(), 302);
  } catch (error) {
    console.error("Google consent URL failed", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Google OAuth not configured",
      },
      { status: 500 },
    );
  }
});
