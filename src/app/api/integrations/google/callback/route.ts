import { exchangeCodeAndStore } from "@/lib/gmail";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = withUser(async (userId, req: Request) => {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error || !code) {
    return Response.redirect(
      new URL(`/settings?google=${error ?? "missing_code"}`, url.origin),
      302,
    );
  }

  try {
    await exchangeCodeAndStore(userId, code);
    return Response.redirect(
      new URL("/settings?google=connected", url.origin),
      302,
    );
  } catch (err) {
    console.error("Google token exchange failed", err);
    return Response.redirect(new URL("/settings?google=failed", url.origin), 302);
  }
});
