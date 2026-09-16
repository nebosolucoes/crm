-- 0260 — agendamentos de envio para grupos WhatsApp
--
-- Escopo deliberado: grupos sao DESTINO de envio, nao origem de conversa.
-- O inbound continua ignorado pelo WAHA/CRM; este schema guarda apenas grupos
-- autorizados, agendamentos e execucoes outbound para `...@g.us`.

create table if not exists public.scheduled_whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  external_group_id text not null,
  name text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint scheduled_whatsapp_groups_external_group_id_check check (external_group_id like '%@g.us'),
  constraint scheduled_whatsapp_groups_name_check check (length(btrim(name)) between 1 and 160),
  constraint scheduled_whatsapp_groups_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint scheduled_whatsapp_groups_org_id_unique unique (organization_id, id),
  constraint scheduled_whatsapp_groups_org_channel_id_unique unique (organization_id, channel_session_id, id),
  constraint scheduled_whatsapp_groups_unique unique (organization_id, channel_session_id, external_group_id),
  constraint scheduled_whatsapp_groups_channel_org_fkey foreign key (organization_id, channel_session_id)
    references public.channel_sessions(organization_id, id) on delete restrict
);

create table if not exists public.scheduled_group_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  group_id uuid not null references public.scheduled_whatsapp_groups(id) on delete restrict,
  title text,
  body text not null,
  status text not null default 'draft',
  starts_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  recurrence_kind text not null default 'none',
  recurrence_config jsonb not null default '{}',
  repeat_until timestamptz,
  max_runs integer,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancel_reason text,
  metadata jsonb not null default '{}',
  constraint scheduled_group_messages_status_check check (status in ('draft', 'scheduled', 'paused', 'cancelled', 'completed')),
  constraint scheduled_group_messages_recurrence_kind_check check (recurrence_kind in ('none', 'daily', 'weekly', 'monthly', 'custom')),
  constraint scheduled_group_messages_body_check check (length(btrim(body)) between 1 and 4000),
  constraint scheduled_group_messages_title_check check (title is null or length(btrim(title)) between 1 and 160),
  constraint scheduled_group_messages_timezone_check check (length(btrim(timezone)) between 1 and 80),
  constraint scheduled_group_messages_recurrence_config_object_check check (jsonb_typeof(recurrence_config) = 'object'),
  constraint scheduled_group_messages_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint scheduled_group_messages_max_runs_check check (max_runs is null or max_runs > 0),
  constraint scheduled_group_messages_cancel_check check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null and cancel_reason is null)
  ),
  constraint scheduled_group_messages_next_run_check check (
    (status = 'scheduled' and next_run_at is not null)
    or (status <> 'scheduled')
  ),
  constraint scheduled_group_messages_org_id_unique unique (organization_id, id),
  constraint scheduled_group_messages_channel_org_fkey foreign key (organization_id, channel_session_id)
    references public.channel_sessions(organization_id, id) on delete restrict,
  constraint scheduled_group_messages_group_org_channel_fkey foreign key (organization_id, channel_session_id, group_id)
    references public.scheduled_whatsapp_groups(organization_id, channel_session_id, id) on delete restrict
);

create table if not exists public.scheduled_group_message_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scheduled_message_id uuid not null references public.scheduled_group_messages(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  group_id uuid not null references public.scheduled_whatsapp_groups(id) on delete restrict,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  attempt integer not null default 1,
  worker_id text,
  claimed_at timestamptz,
  started_at timestamptz,
  sent_at timestamptz,
  external_message_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  constraint scheduled_group_message_runs_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled', 'skipped')),
  constraint scheduled_group_message_runs_attempt_check check (attempt > 0),
  constraint scheduled_group_message_runs_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint scheduled_group_message_runs_sent_check check (
    (status = 'sent' and sent_at is not null and external_message_id is not null)
    or status <> 'sent'
  ),
  constraint scheduled_group_message_runs_error_check check (
    (status = 'failed' and error_code is not null)
    or (status <> 'failed')
  ),
  constraint scheduled_group_message_runs_message_org_fkey foreign key (organization_id, scheduled_message_id)
    references public.scheduled_group_messages(organization_id, id) on delete cascade,
  constraint scheduled_group_message_runs_channel_org_fkey foreign key (organization_id, channel_session_id)
    references public.channel_sessions(organization_id, id) on delete restrict,
  constraint scheduled_group_message_runs_group_org_channel_fkey foreign key (organization_id, channel_session_id, group_id)
    references public.scheduled_whatsapp_groups(organization_id, channel_session_id, id) on delete restrict,
  constraint scheduled_group_message_runs_one_slot unique (organization_id, scheduled_message_id, scheduled_for, attempt)
);

create index if not exists scheduled_whatsapp_groups_org_channel_idx
  on public.scheduled_whatsapp_groups (organization_id, channel_session_id, is_active);

create index if not exists scheduled_group_messages_due_idx
  on public.scheduled_group_messages (next_run_at, organization_id)
  where status = 'scheduled';

create index if not exists scheduled_group_messages_org_status_idx
  on public.scheduled_group_messages (organization_id, status, next_run_at desc);

create index if not exists scheduled_group_message_runs_message_idx
  on public.scheduled_group_message_runs (organization_id, scheduled_message_id, scheduled_for desc);

create index if not exists scheduled_group_message_runs_status_idx
  on public.scheduled_group_message_runs (organization_id, status, scheduled_for desc);

drop trigger if exists trg_scheduled_whatsapp_groups_updated_at on public.scheduled_whatsapp_groups;
create trigger trg_scheduled_whatsapp_groups_updated_at
  before update on public.scheduled_whatsapp_groups
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_scheduled_group_messages_updated_at on public.scheduled_group_messages;
create trigger trg_scheduled_group_messages_updated_at
  before update on public.scheduled_group_messages
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_scheduled_group_message_runs_updated_at on public.scheduled_group_message_runs;
create trigger trg_scheduled_group_message_runs_updated_at
  before update on public.scheduled_group_message_runs
  for each row execute function public.fn_set_updated_at();

alter table public.scheduled_whatsapp_groups enable row level security;
alter table public.scheduled_group_messages enable row level security;
alter table public.scheduled_group_message_runs enable row level security;

drop policy if exists scheduled_whatsapp_groups_select on public.scheduled_whatsapp_groups;
create policy scheduled_whatsapp_groups_select on public.scheduled_whatsapp_groups
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists scheduled_whatsapp_groups_write on public.scheduled_whatsapp_groups;
create policy scheduled_whatsapp_groups_write on public.scheduled_whatsapp_groups
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists scheduled_group_messages_select on public.scheduled_group_messages;
create policy scheduled_group_messages_select on public.scheduled_group_messages
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists scheduled_group_messages_write on public.scheduled_group_messages;
create policy scheduled_group_messages_write on public.scheduled_group_messages
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists scheduled_group_message_runs_select on public.scheduled_group_message_runs;
create policy scheduled_group_message_runs_select on public.scheduled_group_message_runs
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists scheduled_group_message_runs_write on public.scheduled_group_message_runs;
create policy scheduled_group_message_runs_write on public.scheduled_group_message_runs
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.scheduled_whatsapp_groups from public, anon;
revoke all on public.scheduled_group_messages from public, anon;
revoke all on public.scheduled_group_message_runs from public, anon;

grant select, insert, update, delete on public.scheduled_whatsapp_groups to authenticated;
grant select, insert, update, delete on public.scheduled_group_messages to authenticated;
grant select, insert, update, delete on public.scheduled_group_message_runs to authenticated;
grant all on public.scheduled_whatsapp_groups to service_role;
grant all on public.scheduled_group_messages to service_role;
grant all on public.scheduled_group_message_runs to service_role;

comment on table public.scheduled_whatsapp_groups is
  'Grupos WhatsApp autorizados como destino de envios agendados. Nao alimenta inbox nem CRM binding; inbound de @g.us continua ignorado.';
comment on table public.scheduled_group_messages is
  'Agendamento outbound para um grupo WhatsApp salvo. Guarda a intencao, recorrencia e proxima execucao; cada tentativa real fica em scheduled_group_message_runs.';
comment on table public.scheduled_group_message_runs is
  'Historico de execucoes dos agendamentos de grupo: uma linha por tentativa de envio, com status visivel e id externo quando o WAHA aceita.';

notify pgrst, 'reload schema';
