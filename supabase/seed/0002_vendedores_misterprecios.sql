-- Vendedores alineados con las tiendas que devuelve misterprecios.com.
--
-- `id_catalogo` tiene que ser EXACTAMENTE el `data-store-name` de la ficha
-- pasado por `clavear()` (minúsculas, sin tildes). Ese es el valor que arma
-- `extraerOfertas` en src/lib/misterprecios.ts y contra el que matchea
-- `validarYBuscarVendedor`. Si no coinciden, el lead cae en
-- `vendedor_no_asignado` aunque la tienda exista.
--
-- Las seis salieron de un muestreo real del catálogo; si aparece una tienda
-- nueva, el lead va a caer en `vendedor_no_asignado` (cola manual en el panel),
-- que es justo la señal para agregarla acá.
--
-- Antes de correr esto: cambiá los correos por uno tuyo real. Si estás usando
-- MAIL_FROM=onboarding@resend.dev, Resend solo entrega al dueño de la cuenta,
-- así que el correo del vendedor tiene que ser el tuyo o no vas a ver nada.

insert into public.vendedores
  (nombre_tienda, nombre_contacto, email, telefono, categoria, id_catalogo, activo)
values
  ('Monge',      null, 'tu-correo@ejemplo.com', null, 'Electrodomésticos', 'monge',      true),
  ('Gollo',      null, 'tu-correo@ejemplo.com', null, 'Electrodomésticos', 'gollo',      true),
  ('Walmart',    null, 'tu-correo@ejemplo.com', null, 'Retail',            'walmart',    true),
  ('PriceSmart', null, 'tu-correo@ejemplo.com', null, 'Retail',            'pricesmart', true),
  ('Siman',      null, 'tu-correo@ejemplo.com', null, 'Retail',            'siman',      true),
  ('Weltex',     null, 'tu-correo@ejemplo.com', null, 'Electrónica',       'weltex',     true)
on conflict (id_catalogo) where id_catalogo is not null do nothing;
