-- Malvidra Encounter — 0010
-- "Spotlight" marker for exploration/RP (outside combat, where there's no
-- turn tracker): the DM tags who/what the table is waiting on, shown in the
-- room header for everyone and pushed to Discord like a turn change.

alter table public.scenes
  add column if not exists spotlight_user_id uuid references public.profiles (id) on delete set null,
  add column if not exists spotlight_note text;

create or replace function public.trg_notify_spotlight()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
  v_msg text;
begin
  if (new.spotlight_user_id is distinct from old.spotlight_user_id
      or new.spotlight_note is distinct from old.spotlight_note)
     and (new.spotlight_user_id is not null or coalesce(new.spotlight_note, '') <> '') then
    if new.spotlight_user_id is not null then
      select display_name into v_name
      from public.profiles where id = new.spotlight_user_id;
    end if;

    v_msg := '👀 Waiting on';
    if v_name is not null then
      v_msg := v_msg || format(' **%s**', v_name);
    end if;
    if coalesce(new.spotlight_note, '') <> '' then
      v_msg := v_msg || (case when v_name is not null then ': ' else ' ' end) || new.spotlight_note;
    end if;

    perform public.notify_discord(new.room_id, 'scene', v_msg);
  end if;
  return new;
end;
$$;

drop trigger if exists scenes_notify_spotlight on public.scenes;
create trigger scenes_notify_spotlight
after update on public.scenes
for each row execute function public.trg_notify_spotlight();
