"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button, Input, Label } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const next = params.get("next") || "/rooms";

  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  async function continueAsGuest(e: React.FormEvent) {
    e.preventDefault();

    const name = displayName.trim();
    if (!name) return;

    setBusy(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInAnonymously({
        options: {
          data: {
            display_name: name,
          },
        },
      });

      if (error) throw error;

      router.push(next);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not start your guest session",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={continueAsGuest}
      className="space-y-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-5"
    >
      <div>
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          required
          autoFocus
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Rowan the DM"
        />
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Entering…" : "Enter Malvidra Encounter"}
      </Button>

      <p className="text-center text-xs text-neutral-500">
        No account or password required.
      </p>
    </form>
  );
}