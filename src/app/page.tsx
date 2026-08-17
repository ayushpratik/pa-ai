import { redirect } from "next/navigation";

// A conversation id is minted up front; the row is only written to Postgres
// once the first message is actually sent.
export const dynamic = "force-dynamic";

export default function Home() {
  redirect(`/chat/${crypto.randomUUID()}`);
}
