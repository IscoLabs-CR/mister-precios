-- OBSOLETO — no corras este archivo en una instalación nueva.
--
-- Estos vendedores estaban alineados con el catálogo mock que vivía en
-- src/lib/catalogo.ts, ya reemplazado por la integración real con
-- misterprecios.com. Los `id_catalogo` de acá (TIENDA-001, TIENDA-002) no
-- matchean con ninguna tienda real, así que estas filas nunca van a recibir un
-- lead. Usá 0002_vendedores_misterprecios.sql.
--
-- Se conserva solo como referencia del seed original.
--
-- Antes de correr esto: cambiá los correos por uno tuyo real. Si estás usando
-- MAIL_FROM=onboarding@resend.dev, Resend solo entrega al dueño de la cuenta,
-- así que el correo del vendedor tiene que ser el tuyo o no vas a ver nada.

insert into public.vendedores
  (nombre_tienda, nombre_contacto, email, telefono, categoria, id_catalogo, activo)
values
  ('TecnoMax', 'Ana Jiménez', 'tu-correo@ejemplo.com', '+506 2222 1111',
   'Electrónica', 'TIENDA-001', true),
  ('Importadora Delta', 'Luis Vargas', 'tu-correo@ejemplo.com', '+506 2222 2222',
   'Electrónica', 'TIENDA-002', true)
on conflict (id_catalogo) where id_catalogo is not null do nothing;
