-- 0289 — Widget de suporte da instalação (`platform_support_widget`).
--
-- Um botão de suporte em todas as telas logadas: um `<script>` de uma central de
-- chamados externa, com a chave pública do widget, e a identidade de quem está
-- logado assinada por HMAC-SHA256 do id do usuário com o segredo do widget.
--
-- O objeto é a INSTALAÇÃO (o mesmo botão para todas as empresas desta VPS), então
-- o desenho é o de `platform_meta_app` (0257): uma linha só, RLS ligada SEM
-- policies, `anon`/`authenticated` revogados, leitura e escrita pelo
-- `service_role` atrás de `requirePlatformAdmin()`. O segredo é cifrado por
-- `fn_encrypt_oauth` e nunca vai ao navegador: o servidor calcula o HMAC e só o
-- hash atravessa a fronteira.
--
-- Desligado por padrão: sem `enabled` e sem os três campos, nenhuma tela carrega
-- script de terceiro.

create table if not exists public.platform_support_widget (
  id smallint primary key default 1,
  enabled boolean not null default false,
  script_url text,
  public_key text,
  hmac_secret_encrypted bytea,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint platform_support_widget_singleton check (id = 1),
  constraint platform_support_widget_script_https
    check (script_url is null or script_url ~ '^https://'),
  constraint platform_support_widget_public_key_tamanho
    check (public_key is null or length(public_key) between 4 and 200)
);

comment on table public.platform_support_widget is
  'Widget de suporte DESTA INSTALAÇÃO (singleton): URL do script, chave pública e segredo HMAC que assina a identidade do usuário logado. Server-side only: RLS ligada sem policies e grants revogados de anon/authenticated. O segredo nunca volta ao browser; só o HMAC calculado no servidor.';
comment on column public.platform_support_widget.hmac_secret_encrypted is
  'Cifrado por fn_encrypt_oauth. Quem tem este valor se identifica no widget como qualquer usuário e lê os chamados dele.';

alter table public.platform_support_widget enable row level security;

revoke all on public.platform_support_widget from anon, authenticated;
grant select, insert, update on public.platform_support_widget to service_role;

drop trigger if exists trg_platform_support_widget_updated_at on public.platform_support_widget;
create trigger trg_platform_support_widget_updated_at
  before update on public.platform_support_widget
  for each row execute function public.fn_set_updated_at();
