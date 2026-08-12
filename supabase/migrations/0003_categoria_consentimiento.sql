-- Dos campos nuevos del formulario público, los dos obligatorios de ahí en
-- adelante pero NULLABLE en la tabla: las filas que ya existen no tienen ni
-- categoría ni consentimiento, y un default las estaría inventando.
--
-- En `consentimiento_contacto` la diferencia importa: `false` diría que el
-- cliente se negó, y de un lead viejo lo único cierto es que nunca se le
-- preguntó. Por eso null. Un lead nuevo siempre entra con `true` — sin marcar
-- la casilla la API rechaza el POST, así que la columna es el registro de que
-- la autorización se dio, no una preferencia que se pueda apagar.
alter table public.leads
  add column if not exists categoria text,
  add column if not exists consentimiento_contacto boolean;

-- Texto controlado, igual que `estado` y `moneda`. Se recrea en vez de crearse
-- a secas para que agregar una categoría sea reejecutar este bloque.
alter table public.leads
  drop constraint if exists leads_categoria_check;

alter table public.leads
  add constraint leads_categoria_check check (categoria is null or categoria in (
    'refrigeradoras',
    'cocinas',
    'pantallas_tv',
    'consolas_videojuegos',
    'laptops',
    'celulares',
    'secadoras',
    'hornos',
    'lavaplatos',
    'congeladores',
    'plantillas',
    'aires_acondicionados',
    'freidoras_aire'
  ));

-- El panel filtra y agrupa por categoría; los leads viejos no aportan nada a
-- esa consulta, así que quedan fuera del índice.
create index if not exists leads_categoria_idx
  on public.leads (categoria)
  where categoria is not null;
