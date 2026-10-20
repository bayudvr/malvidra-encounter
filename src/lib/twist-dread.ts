import type { DiceDetail } from "@/lib/database.types";

export type HouseSession = {
  id: string; room_id: string; quota: number; player_count: number; capacity: number;
  dread: number; pool: number; active: boolean; created_at: string;
};
export type HousePlayer = {
  session_id: string; room_id: string; user_id: string; twist: number;
};
export type HouseEvent = {
  id: string; session_id: string; room_id: string; actor_user_id: string;
  kind: "setup" | "twist" | "dread" | "distribute";
  target_user_id: string | null; amount: number; base_roll_id: string | null;
  choice_mode: "choose" | "lower" | "higher" | null;
  dread_after: number; pool_after: number; twist_after: number | null;
  created_at: string;
};
export type HouseReroll = {
  id: string; session_id: string; room_id: string; actor_user_id: string;
  resource: "twist" | "dread"; base_roll_id: string; roll_user_id: string | null;
  actor_name: string; notation: string; old_total: number;
  choice_mode: "choose" | "lower" | "higher";
  status: "pending" | "rolled" | "resolved";
  new_detail: DiceDetail[] | null; new_total: number | null;
  chosen: "old" | "new" | null; chosen_total: number | null;
  chosen_roll_id: string | null; created_at: string;
};

export function houseError(error: unknown, fallback: string): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message : fallback;
}
