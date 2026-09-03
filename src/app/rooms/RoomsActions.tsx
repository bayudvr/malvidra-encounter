"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Input, Label, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  return Array.from(
    { length: 8 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

export function RoomsActions() {
  const router = useRouter();
  const toast = useToast();

  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");

  const [busy, setBusy] = useState(false);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();

    const name = roomName.trim();
    if (!name) return;

    setBusy(true);

    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Not signed in");
      }

      const {
        data: room,
        error,
      } = await supabase.rpc("create_room", {
        p_room_name: name,
        p_room_code: generateRoomCode(),
        p_display_name:
          user.user_metadata?.display_name || "DM",
      });

      if (error) throw error;

      if (!room?.id) {
        throw new Error("Room was created but no room ID was returned");
      }

      router.push(`/rooms/${room.id}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not create room",
      );
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault();

    const roomCode = code.trim().toUpperCase();
    if (!roomCode) return;

    setBusy(true);

    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Not signed in");
      }

      const displayName =
        user.user_metadata?.display_name || "Player";

      const {
        data: membership,
        error,
      } = await supabase.rpc("join_room", {
        p_room_code: roomCode,
        p_display_name: displayName,
      });

      if (error) throw error;

      if (!membership?.room_id) {
        throw new Error(
          "Joined successfully but no room ID was returned",
        );
      }

      router.push(`/rooms/${membership.room_id}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not join room",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel title="Create a room">
        <form onSubmit={createRoom} className="space-y-3">
          <div>
            <Label htmlFor="roomName">Room name</Label>

            <Input
              id="roomName"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="The Sunless Citadel"
            />
          </div>

          <Button
            type="submit"
            disabled={busy}
            className="w-full"
          >
            Create room
          </Button>
        </form>
      </Panel>

      <Panel title="Join a room">
        <form onSubmit={joinRoom} className="space-y-3">
          <div>
            <Label htmlFor="code">Room code</Label>

            <Input
              id="code"
              required
              maxLength={8}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase())
              }
              placeholder="A1B2C3D4"
              className="font-mono tracking-widest"
            />
          </div>

          <Button
            type="submit"
            disabled={busy}
            variant="secondary"
            className="w-full"
          >
            Join room
          </Button>
        </form>
      </Panel>
    </div>
  );
}