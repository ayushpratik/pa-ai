import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { env } from "@/lib/env";
import { getUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getUserId()) redirect("/onboarding");

  const { error } = await searchParams;

  return (
    <AuthForm
      mode="login"
      googleEnabled={env.googleLoginEnabled}
      oauthError={typeof error === "string" ? error : undefined}
    />
  );
}
