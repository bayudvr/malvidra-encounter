"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, Input, Label } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";

export function GuestJoin({ code }: { code: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function joinAsGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    try {
      const { error: authError } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: name.trim() } },
      });
      if (authError) throw authError;

      // Make sure the profile name is set even if the trigger raced the metadata.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({ display_name: name.trim() })
          .eq("id", user.id);
      }

      const { data: roomId, error } = await supabase.rpc("join_room", {
        p_code: code,
      });
      if (error) throw error;

      router.push(`/rooms/${roomId}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not join as guest",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-bold text-amber-400">Join the game</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Invite code <span className="font-mono text-neutral-200">{code}</span>
      </p>

      <form
        onSubmit={joinAsGuest}
        className="space-y-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-5"
      >
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Thorne Ironfist"
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Joining…" : "Join as guest"}
        </Button>
        <p className="text-center text-xs text-neutral-500">
          No account needed. Are you the DM or have an account?{" "}
          <Link
            href={`/login?next=/join/${code}`}
            className="text-amber-400 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
