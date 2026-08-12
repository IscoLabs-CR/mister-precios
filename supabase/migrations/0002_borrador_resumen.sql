-- Borrador del resumen ejecutivo que abre el correo al vendedor.
--
-- El correo ya no sale solo: alguien del panel genera un borrador con IA, lo
-- corrige si hace falta y recién entonces lo manda. Por eso el texto vive en la
-- fila del lead y no se arma al vuelo en el momento del envío — lo que se manda
-- tiene que ser exactamente lo que la persona leyó y aprobó.
--
-- Nullable a propósito: un lead sin borrador todavía no está listo para enviar,
-- y esa es justamente la señal que usa el panel para bloquear el botón.
alter table public.leads
  add column if not exists resumen_borrador text,
  add column if not exists resumen_borrador_at timestamptz;
