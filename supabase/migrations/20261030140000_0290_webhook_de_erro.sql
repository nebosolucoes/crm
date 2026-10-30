-- 0290 — Webhook de erro da instalação (`platform_error_webhook`).
--
-- Todo erro gravado em `api_error_log` (migration 0288) pode também ser
-- enviado, na hora, a um endereço externo — tipicamente o webhook de uma
-- central de chamados, que abre um card por erro. O `request_id` vai como
-- identificador externo: reenviar o mesmo erro não duplica o card.
--
-- Molde de `platform_meta_app` (0257) e `platform_support_widget` (0289): uma
-- linha só, RLS ligada SEM policies, `anon`/`authenticated` revogados, escrita
-- pelo `service_role` atrás de `requirePlatformAdmin()`. O segredo que assina
-- o corpo (HMAC-SHA256) é cifrado por `fn_encrypt_oauth`.
--
-- `scope`: `all` manda todo erro (4xx inclusive); `server` só os 5xx e as
-- exceções não tratadas. Desligado por padrão.

create table if not exists public.platform_error_webhook (
  id smallint primary key default 1,
  enabled boolean not null default false,
  url text,
  secret_encrypted bytea,
  scope text not null default 'all',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint platform_error_webhook_singleton check (id = 1),
  constraint platform_error_webhook_url_http
    check (url is null or url ~ '^https?://'),
  constraint platform_error_webhook_scope
    check (scope in ('all', 'server'))
);

comment on table public.platform_error_webhook is
  'Webhook de erro DESTA INSTALAÇÃO (singleton): cada erro de api_error_log é enviado a este endereço (um card por erro na central de chamados), com o request_id como id externo. Server-side only: RLS ligada sem policies e grants revogados de anon/authenticated.';
comment on column public.platform_error_webhook.secret_encrypted is
  'Cifrado por fn_encrypt_oauth. Assina o corpo enviado (X-Nebo-Assinatura: sha256=<HMAC-SHA256>). Nunca volta ao browser.';

alter table public.platform_error_webhook enable row level security;

revoke all on public.platform_error_webhook from anon, authenticated;
grant select, insert, update on public.platform_error_webhook to service_role;

drop trigger if exists trg_platform_error_webhook_updated_at on public.platform_error_webhook;
create trigger trg_platform_error_webhook_updated_at
  before update on public.platform_error_webhook
  for each row execute function public.fn_set_updated_at();
