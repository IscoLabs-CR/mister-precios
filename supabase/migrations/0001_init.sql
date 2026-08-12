-- Mr Precios — esquema inicial
--
-- Principios de seguridad (mismo criterio que app_config en los otros proyectos):
--   1. RLS activo en TODAS las tablas y CERO policies. Solo service_role, que
--      bypassea RLS, puede leer o escribir. El formulario público escribe
--      siempre a través de /api/leads; el navegador nunca habla con Supabase.
--   2. Se revocan además los grants de anon/authenticated, por si alguna vez se
--      agrega una policy por error.
--   3. Estados como texto controlado con `check`, no como enum de Postgres.
--
-- Zona horaria: todo se guarda en timestamptz (UTC). La conversión a hora de
-- Costa Rica ocurre solo al presentar en el panel.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Vendedores aliados (base de contactos propia, NO el catálogo de productos)
-- ---------------------------------------------------------------------------
create table public.vendedores (
  id uuid primary key default gen_random_uuid(),
  nombre_tienda text not null,
  nombre_contacto text,
  email text not null,
  telefono text,
  categoria text,
  -- identificador que usa la base externa para esta tienda, si existe
  id_catalogo text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Una tienda del catálogo externo mapea a un solo vendedor.
create unique index vendedores_id_catalogo_key
  on public.vendedores (id_catalogo)
  where id_catalogo is not null;

-- Fallback de matcheo por nombre cuando la tienda no trae id_catalogo.
create index vendedores_nombre_tienda_idx
  on public.vendedores (lower(nombre_tienda));

create index vendedores_activos_idx
  on public.vendedores (activo)
  where activo;

-- ---------------------------------------------------------------------------
-- Leads capturados desde el formulario
-- ---------------------------------------------------------------------------

-- Secuencia para el código legible. Usar el default de la secuencia hace que la
-- generación sea atómica: no hay carrera posible entre dos envíos simultáneos.
create sequence public.leads_code_seq start with 1;

create table public.leads (
  id uuid primary key default gen_random_uuid(),

  -- Código corto legible (LEAD-0001). Es la llave de matcheo con las
  -- cotizaciones que llegan por correo, así que va en el asunto del correo.
  lead_code text not null unique
    default 'LEAD-' || lpad(nextval('public.leads_code_seq')::text, 4, '0'),

  nombre text not null,
  email text not null,
  telefono text,

  -- texto crudo que escribió el cliente
  producto_texto text not null,
  -- {marca, modelo, variante} extraído por IA; null si la IA falló (reintentable)
  producto_normalizado jsonb,

  link_referencia text,
  -- rutas dentro del bucket 'leads-fotos', NO URLs públicas
  fotos_urls text[] not null default '{}',

  precio_visto numeric(12,2) check (precio_visto is null or precio_visto > 0),
  moneda text not null default 'CRC' check (moneda in ('CRC', 'USD')),

  -- true = abierto a opciones similares
  flexible boolean not null,

  estado text not null default 'nuevo' check (estado in (
    'nuevo',
    'validado',
    'vendedor_no_asignado',
    'enviado_vendedor',
    'cotizado',
    'en_proceso',
    'cerrado_ganado',
    'cerrado_perdido',
    'sin_asignar'
  )),

  tienda_candidata text,
  vendedor_id uuid references public.vendedores(id) on delete set null,
  precio_a_vencer numeric(12,2),

  -- Token no adivinable para los enlaces de cierre a 72h que van por correo.
  -- El UUID ES el token; no hace falta un secreto de firma aparte.
  action_token uuid not null default gen_random_uuid(),

  fecha_enviado_vendedor timestamptz,
  recordatorio_24h_enviado boolean not null default false,
  fecha_cotizacion_recibida timestamptz,
  fecha_verificacion_enviada timestamptz,

  resultado_cierre text
    check (resultado_cierre in ('ganado', 'perdido', 'en_proceso')),

  created_at timestamptz not null default now()
);

create unique index leads_action_token_key on public.leads (action_token);
create index leads_estado_idx on public.leads (estado);
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_vendedor_idx on public.leads (vendedor_id);
create index leads_nombre_idx on public.leads (lower(nombre));

-- Índice parcial que sirve exactamente la consulta del cron de 24h.
create index leads_pendientes_recordatorio_idx
  on public.leads (fecha_enviado_vendedor)
  where estado = 'enviado_vendedor' and recordatorio_24h_enviado = false;

-- Índice parcial que sirve exactamente la consulta del cron de 72h.
create index leads_pendientes_verificacion_idx
  on public.leads (fecha_cotizacion_recibida)
  where estado = 'cotizado' and fecha_verificacion_enviada is null;

-- ---------------------------------------------------------------------------
-- Cotizaciones recibidas de los vendedores
-- ---------------------------------------------------------------------------
create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),

  -- NULLABLE a propósito: una cotización que llega sin lead_code reconocible se
  -- guarda igual con lead_id = null y se vincula a mano desde el panel.
  lead_id uuid references public.leads(id) on delete cascade,

  -- ruta en el bucket 'cotizaciones' del PDF/imagen original
  archivo_url text,
  precio_cotizado numeric(12,2),
  condiciones text,
  vigencia_dias integer check (vigencia_dias is null or vigencia_dias >= 0),

  -- respuesta cruda de la IA, para auditar extracciones dudosas
  extraido_por_ia jsonb,

  -- Contexto del correo entrante. Sin esto, una cotización sin lead_id no le da
  -- al operador nada con qué identificarla en el panel.
  remitente text,
  asunto text,

  created_at timestamptz not null default now()
);

create index cotizaciones_lead_idx on public.cotizaciones (lead_id);

create index cotizaciones_sin_asignar_idx
  on public.cotizaciones (created_at desc)
  where lead_id is null;

-- ---------------------------------------------------------------------------
-- Log de alertas enviadas (para no duplicar y para auditoría)
-- ---------------------------------------------------------------------------
create table public.alertas_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo text not null check (tipo in ('recordatorio_24h', 'verificacion_72h')),
  enviado_en timestamptz not null default now(),
  destinatario text
);

-- Hace los crons idempotentes: reintentar no duplica el correo. La
-- verificación de 72h manda a cliente y vendedor, por eso el destinatario
-- forma parte de la llave.
create unique index alertas_log_unica_idx
  on public.alertas_log (lead_id, tipo, coalesce(destinatario, ''));

-- ---------------------------------------------------------------------------
-- Historial de estados del lead
-- ---------------------------------------------------------------------------
-- El panel pide "historial de estados con timestamps". Las columnas por hito
-- del lead (fecha_enviado_vendedor, etc.) no alcanzan: no registran los
-- rebotes ni el motivo de una transición.
create table public.lead_eventos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  estado_anterior text,
  estado_nuevo text,
  nota text,
  created_at timestamptz not null default now()
);

create index lead_eventos_lead_idx on public.lead_eventos (lead_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.vendedores    enable row level security;
alter table public.leads         enable row level security;
alter table public.cotizaciones  enable row level security;
alter table public.alertas_log   enable row level security;
alter table public.lead_eventos  enable row level security;

-- Intencionalmente SIN policies: solo service_role.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Buckets privados. Sin policies en storage.objects => solo service_role sube y
-- lee. El panel muestra los archivos con URLs firmadas de corta duración.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('leads-fotos', 'leads-fotos', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('cotizaciones', 'cotizaciones', false, 20971520,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
