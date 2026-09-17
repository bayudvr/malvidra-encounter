// Hand-written to mirror supabase/migrations/0001_init.sql.
// Regenerate with: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type SceneMode = "exploration" | "combat";
export type MemberRole = "dm" | "player";

/** One die group in a roll, e.g. { sides: 6, values: [3, 5] }. */
export type DiceDetail = { sides: number; values: number[] };

type Timestamps = { created_at: string };

export interface Database {
  public: {
    Tables: {
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
        } & Timestamps;
        Insert: {
          id?: string;
          room_id: string;
          name: string;
          image_url?: string | null;
          hp?: number;
          ac?: number;
          created_at?: string;
        };
        Update: {
          name?: string;
          image_url?: string | null;
          hp?: number;
          ac?: number;
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
      dice_rolls: {
        Row: {
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
      join_room: { Args: { p_code: string }; Returns: string };
      seed_scene_combatants: { Args: { p_scene: string }; Returns: undefined };
      is_room_member: { Args: { p_room: string }; Returns: boolean };
      is_room_dm: { Args: { p_room: string }; Returns: boolean };
      send_test_discord_webhook: { Args: { p_room: string }; Returns: undefined };
      rotate_cast_token: { Args: { p_room: string }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
