import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";
import { DiscordLink } from "./DiscordLink";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ linked?: string; error?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect("/rooms");
  const params = await searchParams;
  const linked = user.identities?.some(identity => identity.provider === "discord") ?? false;
  return <main className="mx-auto max-w-xl space-y-5 p-6">
    <Link href="/rooms" className="text-sm text-amber-400 hover:underline">‹ Back to rooms</Link>
    <h1 className="text-xl font-bold text-amber-400">Account connections</h1>
    <p className="text-sm text-neutral-400">Encounter account: {user.email ?? "Existing account"}</p>
    <Panel title="Discord">
      {params.error && <p className="mb-3 text-sm text-red-400" role="alert">Linking could not be completed. Your existing Encounter account has not been replaced. Sign in and try again, or contact support if Discord is already connected to another account.</p>}
      <DiscordLink linked={linked} />
      <p className="mt-3 text-xs text-neutral-500">Linking prepares your existing account for Discord integration. It does not yet sign you into an embedded Encounter session.</p>
    </Panel>
  </main>;
}
