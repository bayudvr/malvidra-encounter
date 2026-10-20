import type { HouseSession, HousePlayer, HouseEvent, HouseReroll } from "@/lib/twist-dread";

// Hand-written to mirror supabase/migrations/0001_init.sql.
// Regenerate with: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type SceneMode = "exploration" | "combat";
export type MemberRole = "dm" | "player" | "spectator";

/** One die group in a roll, e.g. { sides: 6, values: [3, 5] }. */
export type DiceDetail = { sides: number; values: number[] };

export type ActionRequest = {
  id: string;
  room_id: string;
  target_user_id: string;
  prompt: string;
  kind: "action" | "roll";
  dc: number | null;
  status: "pending" | "completed" | "cancelled";
  dice_roll_id: string | null;
  result_total: number | null;
  result_notation: string | null;
  created_at: string;
  resolved_at: string | null;
};

type Timestamps = { created_at: string };

export interface Database {
  public: {
    Tables: {
      house_sessions: { Row: HouseSession; Insert: never; Update: never; Relationships: [] };
      house_players: { Row: HousePlayer; Insert: never; Update: never; Relationships: [] };
      house_events: { Row: HouseEvent; Insert: never; Update: never; Relationships: [] };
      house_rerolls: { Row: HouseReroll; Insert: never; Update: never; Relationships: [] };
      action_requests: {
        Row: ActionRequest;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: { id: string; display_name: string } & Timestamps;
        Insert: { id: string; display_name?: string; created_at?: string };
        Update: { display_name?: string };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          name: string;
          dm_id: string;
          invite_code: string;
          cast_token: string;
          active_scene_id: string | null;
          archived_at: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          name: string;
          dm_id: string;
          invite_code?: string;
          cast_token?: string;
          active_scene_id?: string | null;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          active_scene_id?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      room_members: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          role: MemberRole;
          joined_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          role: MemberRole;
          joined_at?: string;
        };
        Update: { role?: MemberRole };
        Relationships: [];
      };
      assets: {
        Row: {
          id: string;
          room_id: string;
          name: string;
          image_url: string | null;
          hp: number;
          ac: number;
          owner_user_id: string | null;
          carry_state: boolean;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          name: string;
          image_url?: string | null;
          hp?: number;
          ac?: number;
          owner_user_id?: string | null;
          carry_state?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          image_url?: string | null;
          hp?: number;
          ac?: number;
          owner_user_id?: string | null;
          carry_state?: boolean;
        };
        Relationships: [];
      };
      scenes: {
        Row: {
          id: string;
          room_id: string;
          name: string;
          mode: SceneMode;
          map_url: string | null;
          grid_size: number;
          grid_enabled: boolean;
          snap_to_grid: boolean;
          grid_color: string;
          grid_opacity: number;
          grid_thickness: number;
          feet_per_square: number;
          position: number;
          round: number;
          active_combatant_id: string | null;
          spotlight_user_id: string | null;
          spotlight_note: string | null;
          fog_enabled: boolean;
          fog_color: string;
          fog_dm_opacity: number;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          name: string;
          mode?: SceneMode;
          map_url?: string | null;
          grid_size?: number;
          grid_enabled?: boolean;
          snap_to_grid?: boolean;
          grid_color?: string;
          grid_opacity?: number;
          grid_thickness?: number;
          feet_per_square?: number;
          position?: number;
          round?: number;
          active_combatant_id?: string | null;
          spotlight_user_id?: string | null;
          spotlight_note?: string | null;
          fog_enabled?: boolean;
          fog_color?: string;
          fog_dm_opacity?: number;
          created_at?: string;
        };
        Update: {
          name?: string;
          mode?: SceneMode;
          map_url?: string | null;
          grid_size?: number;
          grid_enabled?: boolean;
          snap_to_grid?: boolean;
          grid_color?: string;
          grid_opacity?: number;
          grid_thickness?: number;
          spotlight_user_id?: string | null;
          spotlight_note?: string | null;
          fog_enabled?: boolean;
          fog_color?: string;
          fog_dm_opacity?: number;
          feet_per_square?: number;
          position?: number;
          round?: number;
          active_combatant_id?: string | null;
        };
        Relationships: [];
      };
      tokens: {
        Row: {
          id: string;
          scene_id: string;
          room_id: string;
          asset_id: string | null;
          label: string;
          image_url: string | null;
          x: number;
          y: number;
          size: number;
          color: string | null;
          owner_user_id: string | null;
          is_hidden: boolean;
          hp: number;
          ac: number;
          vision_radius_ft: number | null;
          monster_name: string | null;
          monster_source: string | null;
          monster_cr: string | null;
          state_changed_at: string;
        } & Timestamps;
        Insert: {
          id?: string;
          scene_id: string;
          room_id: string;
          asset_id?: string | null;
          label?: string;
          image_url?: string | null;
          x?: number;
          y?: number;
          size?: number;
          color?: string | null;
          owner_user_id?: string | null;
          is_hidden?: boolean;
          hp?: number;
          ac?: number;
          vision_radius_ft?: number | null;
          monster_name?: string | null;
          monster_source?: string | null;
          monster_cr?: string | null;
          created_at?: string;
        };
        Update: {
          label?: string;
          image_url?: string | null;
          x?: number;
          y?: number;
          size?: number;
          color?: string | null;
          owner_user_id?: string | null;
          is_hidden?: boolean;
          hp?: number;
          ac?: number;
          vision_radius_ft?: number | null;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          room_id: string;
          user_id: string | null;
          token_id: string | null;
          speaker_name: string;
          body: string;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          user_id?: string | null;
          token_id?: string | null;
          speaker_name: string;
          body: string;
          created_at?: string;
        };
        Update: { body?: string };
        Relationships: [];
      };
      dice_rolls: {
        Row: {
          superseded_by: string | null;
          id: string;
          room_id: string;
          user_id: string | null;
          actor_name: string;
          notation: string;
          detail: DiceDetail[];
          total: number;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          user_id?: string | null;
          actor_name: string;
          notation: string;
          detail?: DiceDetail[];
          total: number;
          created_at?: string;
        };
        Update: { actor_name?: string; notation?: string; total?: number };
        Relationships: [];
      };
      room_webhooks: {
        Row: {
          id: string;
          room_id: string;
          discord_webhook_url: string;
          notify_combat: boolean;
          notify_dice: boolean;
          notify_scene: boolean;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          discord_webhook_url: string;
          notify_combat?: boolean;
          notify_dice?: boolean;
          notify_scene?: boolean;
          created_at?: string;
        };
        Update: {
          discord_webhook_url?: string;
          notify_combat?: boolean;
          notify_dice?: boolean;
          notify_scene?: boolean;
        };
        Relationships: [];
      };
      combatants: {
        Row: {
          id: string;
          scene_id: string;
          room_id: string;
          name: string;
          initiative: number | null;
          sort_order: number;
          hp: number | null;
          max_hp: number | null;
          temp_hp: number | null;
          ac: number | null;
          is_player: boolean;
          user_id: string | null;
          token_id: string | null;
          conditions: string[];
          is_hidden: boolean;
        } & Timestamps;
        Insert: {
          id?: string;
          scene_id: string;
          room_id: string;
          name: string;
          initiative?: number | null;
          sort_order?: number;
          hp?: number | null;
          max_hp?: number | null;
          temp_hp?: number | null;
          ac?: number | null;
          is_player?: boolean;
          user_id?: string | null;
          token_id?: string | null;
          conditions?: string[];
          is_hidden?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          initiative?: number | null;
          sort_order?: number;
          hp?: number | null;
          max_hp?: number | null;
          temp_hp?: number | null;
          ac?: number | null;
          conditions?: string[];
          token_id?: string | null;
          is_hidden?: boolean;
        };
        Relationships: [];
      };
      fog_polygons: {
        Row: {
          id: string;
          scene_id: string;
          room_id: string;
          points: [number, number][];
        } & Timestamps;
        Insert: {
          id?: string;
          scene_id: string;
          room_id: string;
          points: [number, number][];
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      fog_doors: {
        Row: {
          id: string;
          scene_id: string;
          room_id: string;
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          is_open: boolean;
        } & Timestamps;
        Insert: {
          id?: string;
          scene_id: string;
          room_id: string;
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          is_open?: boolean;
          created_at?: string;
        };
        Update: {
          is_open?: boolean;
        };
        Relationships: [];
      };
      token_auras: {
        Row: {
          id: string;
          token_id: string;
          scene_id: string;
          room_id: string;
          radius_ft: number;
          color: string;
        } & Timestamps;
        Insert: {
          id?: string;
          token_id: string;
          scene_id: string;
          room_id: string;
          radius_ft?: number;
          color?: string;
          created_at?: string;
        };
        Update: { radius_ft?: number; color?: string };
        Relationships: [];
      };
      scene_drawings: {
        Row: {
          id: string;
          scene_id: string;
          room_id: string;
          user_id: string;
          points: number[];
          color: string;
          width: number;
        } & Timestamps;
        Insert: {
          id?: string;
          scene_id: string;
          room_id: string;
          user_id?: string;
          points: number[];
          color?: string;
          width?: number;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      walls: {
        Row: {
          id: string;
          scene_id: string;
          room_id: string;
          points: [number, number][];
        } & Timestamps;
        Insert: {
          id?: string;
          scene_id: string;
          room_id: string;
          points: [number, number][];
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      room_counters: {
        Row: {
          id: string;
          room_id: string;
          name: string;
          current: number;
          max: number;
          visibility: "public" | "private";
          sort_order: number;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          name?: string;
          current?: number;
          max?: number;
          visibility?: "public" | "private";
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          name?: string;
          current?: number;
          max?: number;
          visibility?: "public" | "private";
          sort_order?: number;
        };
        Relationships: [];
      };
      token_counters: {
        Row: {
          id: string;
          token_id: string;
          room_id: string;
          name: string;
          current: number;
          max: number;
          sort_order: number;
        } & Timestamps;
        Insert: {
          id?: string;
          token_id: string;
          room_id: string;
          name?: string;
          current?: number;
          max?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          name?: string;
          current?: number;
          max?: number;
          sort_order?: number;
        };
        Relationships: [];
      };
      dm_notes: {
        Row: {
          id: string;
          room_id: string;
          title: string;
          content: string;
          updated_at: string;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          title?: string;
          content?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          content?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      saved_references: {
        Row: {
          id: string;
          room_id: string;
          name: string;
          type: string;
          source: string | null;
          data: Record<string, unknown>;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          name: string;
          type: string;
          source?: string | null;
          data: Record<string, unknown>;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      player_requests: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          note: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          note?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      set_room_member_role: {
        Args: { p_room: string; p_user: string; p_role: "player" | "spectator" };
        Returns: undefined;
      };
      setup_house_session: {
        Args: { p_room: string; p_quota: number; p_players: string[]; p_operation: string };
        Returns: HouseSession[];
      };
      apply_house_event: {
        Args: { p_session: string; p_kind: string; p_operation: string; p_target?: string | null; p_amount?: number; p_roll?: string | null; p_mode?: string | null };
        Returns: HouseEvent[];
      };
      submit_house_reroll: {
        Args: { p_reroll: string; p_detail: DiceDetail[] };
        Returns: HouseReroll[];
      };
      resolve_house_reroll: {
        Args: { p_reroll: string; p_choice: string };
        Returns: HouseReroll[];
      };
      create_action_request: {
        Args: { p_room: string; p_target: string; p_prompt: string; p_kind: string; p_dc?: number | null };
        Returns: ActionRequest[];
      };
      complete_action_request: {
        Args: { p_request: string; p_values?: number[] | null; p_modifier?: number; p_mode?: string };
        Returns: ActionRequest[];
      };
      cancel_action_request: {
        Args: { p_request: string };
        Returns: ActionRequest[];
      };
      join_room: { Args: { p_code: string }; Returns: string };
      seed_scene_combatants: { Args: { p_scene: string }; Returns: undefined };
      spawn_asset_token: {
        Args: {
          p_scene: string;
          p_asset: string;
          p_x: number;
          p_y: number;
          p_fresh?: boolean;
        };
        Returns: Database["public"]["Tables"]["tokens"]["Row"];
      };
      is_room_member: { Args: { p_room: string }; Returns: boolean };
      is_room_dm: { Args: { p_room: string }; Returns: boolean };
      send_test_discord_webhook: { Args: { p_room: string }; Returns: undefined };
      rotate_cast_token: { Args: { p_room: string }; Returns: string };
      adjust_own_combatant_hp: {
        Args: { p_combatant: string; p_delta: number };
        Returns: Database["public"]["Tables"]["combatants"]["Row"];
      };
      toggle_own_combatant_condition: {
        Args: { p_combatant: string; p_condition: string };
        Returns: Database["public"]["Tables"]["combatants"]["Row"];
      };
      end_own_turn: {
        Args: { p_scene: string };
        Returns: Database["public"]["Tables"]["scenes"]["Row"];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
