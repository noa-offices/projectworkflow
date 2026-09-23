create table if not exists public.ai_provider_settings (
  provider_id text primary key,
  enabled boolean not null default true,
  default_model text null,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(id) on delete set null
);

create table if not exists public.ai_agent_settings (
  agent_id text primary key,
  provider_id text null,
  model text null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(id) on delete set null
);

alter table public.ai_provider_settings enable row level security;
alter table public.ai_agent_settings enable row level security;

create policy "authenticated users can read AI runtime settings"
  on public.ai_provider_settings for select to authenticated using (true);
create policy "system owners manage AI provider settings"
  on public.ai_provider_settings for all to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'system_owner')
  with check ((select role from public.profiles where id = auth.uid()) = 'system_owner');

create policy "authenticated users can read AI agent settings"
  on public.ai_agent_settings for select to authenticated using (true);
create policy "system owners manage AI agent settings"
  on public.ai_agent_settings for all to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'system_owner')
  with check ((select role from public.profiles where id = auth.uid()) = 'system_owner');
