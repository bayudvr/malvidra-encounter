"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function DiscordLink({ linked }: { linked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect() {
    if (busy || linked) return;
    setBusy(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user || user.is_anonymous) throw new Error("Sign in to your existing Encounter account first.");
      const { data, error: linkError } = await supabase.auth.linkIdentity({
        provider: "discord",
        options: { redirectTo: new URL("/auth/discord-link", window.location.origin).toString(), skipBrowserRedirect: true },
      });
      if (linkError) throw linkError;
      if (!data.url) throw new Error("Discord authorization URL was not returned.");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to link Discord.");
      setBusy(false);
    }
  }
  return <div className="space-y-3">
    {linked ? <p className="text-emerald-400" role="status">Discord is linked to this Encounter account.</p> : <>
      <p className="text-sm text-neutral-300">Authorize your Discord account to attach it to the Encounter account you are signed in to. Your rooms, maps, tokens and permissions stay with the existing account.</p>
      <Button type="button" onClick={connect} disabled={busy}>{busy ? "Opening Discord…" : "Link Discord account"}</Button>
    </>}
    {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
  </div>;
}
