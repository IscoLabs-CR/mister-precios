# Mister Precios — panel de leads

Un cliente pide un producto por un formulario público; la app busca ese producto
en un catálogo de tiendas, calcula el precio a vencer y arma el correo con el que
un vendedor aliado compite por la venta. El seguimiento vive en un panel interno.

**El código está comentado explicando el porqué de cada decisión.** Este archivo
cubre lo que no cabe en un comentario: cómo levantarlo, qué es deliberado y qué
hay que tocar si el proyecto cambia de manos.

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v3 · Supabase
(Postgres + Auth + Storage) · Gemini 3.7 Flash · Resend · pensado para Vercel.

## Estado actual

**Nunca se desplegó.** Todo lo que sigue funciona y se probó en desarrollo contra
la base real, pero no hay hosting: no existe proyecto en Vercel ni URL pública.

Dos consecuencias:

- **El cron nunca corrió.** El recordatorio de 24h y la verificación de 72h están
  escritos y el endpoint está protegido, pero nunca se ejecutaron programados.
  Es la única parte del flujo sin probar en condiciones reales — conviene
  verificarla en el primer deploy y no descubrirla con el lead de un cliente.
- **La base está vacía a propósito.** Se borraron los leads y vendedores de
  prueba. Antes de recibir el primer lead real hay que cargar los vendedores.

Lo que sí está montado y funcionando es el correo (Resend para enviar, un buzón
real de SiteGround para recibir), sobre el dominio del dueño de la marca.

---

## El flujo, de punta a punta

| # | Paso | Quién lo hace | Estado en que queda |
|---|---|---|---|
| 1 | El cliente envía el formulario (`/solicitar`) | Automático | `nuevo` |
| 2 | La IA extrae marca/modelo y se busca en el catálogo | Automático, en segundo plano | `vendedor_no_asignado` |
| 3 | Se elige el vendedor y se aprueba el borrador del correo | **Manual, en el panel** | `validado` → `enviado_vendedor` |
| 4 | Recordatorio si el vendedor no responde en 24h | Cron horario | — |
| 5 | Se carga la cotización que respondió el vendedor | **Manual, en el panel** | `cotizado` |
| 6 | Verificación a las 72h, con enlaces de cierre por correo | Cron horario | `cerrado_ganado` / `cerrado_perdido` / `en_proceso` |

Dos cosas son manuales **a propósito**, no por falta de tiempo:

- **La asignación del vendedor (paso 3).** Antes se elegía solo, matcheando la
  tienda más barata del catálogo contra la tabla `vendedores`. Se quitó porque la
  tienda más barata no siempre es la que conviene contactar, y adivinarlo mandaba
  correos que después había que desdecir. Lo que el paso 2 sí deja resuelto es
  `tienda_candidata` y `precio_a_vencer`: el dato con el que la persona decide.
- **La carga de la cotización (paso 5).** Ver "Lo que quedó pendiente".

Ningún correo sale sin que alguien lo lea antes. El resumen ejecutivo se genera
con IA en el panel, se corrige a mano y recién ahí se envía; por eso el texto
vive en la fila del lead (`resumen_borrador`) y no se arma al vuelo — lo que se
manda tiene que ser exactamente lo que la persona aprobó.

**El cliente va en copia del correo al vendedor.** Es decisión de producto: ve
qué se pidió en su nombre y a quién. Tiene dos consecuencias que hay que
sostener — el borrador se redacta sabiendo que el cliente lo lee, y su dirección
queda visible para el vendedor desde el primer contacto.

---

## Levantarlo desde cero

### 1. Base de datos

Un proyecto Supabase nuevo, y correr en orden desde el SQL editor:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_borrador_resumen.sql
supabase/migrations/0003_categoria_consentimiento.sql
```

Después, `supabase/seed/0002_vendedores_misterprecios.sql` **cambiando los
correos** por direcciones reales de cada vendedor. (`0001_vendedores_demo.sql`
está obsoleto: sus `id_catalogo` no matchean con ninguna tienda real.)

El modelo de seguridad es deliberado y conviene no aflojarlo: **RLS activo en
todas las tablas y cero policies.** Solo `service_role` lee y escribe. El
navegador nunca habla con Supabase salvo para el login del panel. Los buckets
(`leads-fotos`, `cotizaciones`) son privados y se sirven con URLs firmadas de
corta duración.

### 2. Variables de entorno

Copiar `.env.example` a `.env.local` y completar. Las que más se equivocan:

- `SUPABASE_SERVICE_ROLE_KEY` — **secreta**, bypassea RLS. Jamás con prefijo
  `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SITE_URL` — base de los enlaces absolutos de los correos. Si queda
  mal, los botones de cierre del correo de 72h no abren y nadie se entera.
- `CRON_SECRET` — sin ella el endpoint del cron responde 401 y **las alertas no
  salen**. Vercel la manda sola como `Authorization: Bearer` si está definida en
  el proyecto.
- `MAIL_FROM` — tiene que estar en un dominio verificado en Resend. Para probar
  sin dominio, `onboarding@resend.dev` entrega **solo** al dueño de la cuenta.

### 3. Usuarios del panel

Se crean a mano en Supabase Dashboard → Authentication → Users. No hay registro
público ni invitaciones: el panel es interno.

### 4. Deploy

Vercel, con las mismas variables cargadas en el proyecto. El cron está declarado
en `vercel.json` con cadencia horaria; **en el plan Hobby los crons son diarios**,
y con eso alcanza — los umbrales son de 24h y 72h, así que una corrida diaria
cumple igual, solo que la alerta puede salir hasta un día más tarde.

---

## Correo

**Verificar un dominio en Resend habilita ENVIAR, nunca recibir.** Es el error
que más caro sale acá, porque todas las plantillas le piden al vendedor
"respondé este correo": si la dirección del remitente no recibe, cada cotización
que responde un vendedor rebota y el flujo se corta en el paso 5.

Por eso hay tres variables y no una:

| Variable | Qué es | Dónde tiene que estar |
|---|---|---|
| `MAIL_FROM` | Remitente | Dominio o subdominio **verificado en Resend** |
| `MAIL_REPLY_TO` | A dónde contestan los vendedores | Casilla real, en un dominio **con MX** |
| `MAIL_CC_INTERNO` | Copia interna de control | Cualquier casilla del equipo |

El montaje típico es un subdominio dedicado al envío (`envios.<dominio>` o
similar) verificado en Resend, y el `MAIL_REPLY_TO` apuntando a una casilla del
dominio raíz, que es la que ya recibe correo. Un subdominio verificado en Resend
**no** tiene MX: si no hay `MAIL_REPLY_TO`, las respuestas rebotan de inmediato.

Resend pone su SPF y su MX de return-path en un subdominio propio, y el DKIM en
`resend._domainkey`. Eso significa que **la verificación no toca el SPF de la
raíz** — importante si el dominio ya tiene correo de empresa andando: fusionar o
pisar ese SPF les tumba el correo a todos. Solo hay que agregar los registros que
da Resend, nunca editar los que ya están.

Al diagnosticar, consultar el nameserver autoritativo en vez de un resolver
público: evita el caché negativo y distingue "no está configurado" de "todavía no
propagó".

Toda la app manda correo por `src/lib/correo/resend.ts`. Cambiar de proveedor es
reescribir ese archivo y nada más.

---

## Lo que quedó pendiente a propósito

**Recepción automática de cotizaciones.** Que la respuesta del vendedor entre
sola y cree la cotización está pospuesto, no roto. En su lugar existe la carga
manual desde la página del lead: precio, vigencia, condiciones y documento.

La infraestructura ya está lista para cuando se retome: el `lead_code` viaja en
el asunto del correo, y las columnas `remitente`, `asunto` y `extraido_por_ia` de
la tabla `cotizaciones` existen para ese flujo (hoy quedan nulas).

Dos advertencias para quien lo retome:

1. `cotizaciones@misterprecios.com` es un **buzón real en SiteGround**, no un
   reenvío, así que se puede leer por IMAP. Ese es hoy el camino más directo; la
   otra alternativa es la recepción entrante de Resend.
2. La respuesta del vendedor **cita el correo original**, que incluye nuestro
   "precio a vencer". Hay que recortar la cita antes de que la IA lea el texto, o
   va a extraer nuestro propio número como si fuera la cotización del vendedor.

---

## Los dos seams del proyecto

Si algo grande va a cambiar, casi seguro es uno de estos dos, y los dos están
aislados para que el cambio no se derrame:

- **`src/lib/catalogo.ts`** — el resto del proyecto solo conoce
  `ResultadoCatalogo`, `buscarProducto` y `filtrarPorFlexibilidad`. Hoy los tres
  se resuelven contra misterprecios.com (`src/lib/misterprecios.ts`), scrapeando
  el buscador público del sitio. Cambiar de origen es reescribir ese archivo.
  Contrato que el flujo asume: `buscarProducto` **nunca lanza** — ante un fallo
  devuelve `[]` y loguea, porque un throw dejaría el lead trabado en `nuevo`.
- **`src/lib/correo/resend.ts`** — ver arriba.

**Riesgo heredado:** el catálogo se lee scrapeando un sitio de terceros. El
cliente HTTP se identifica con un agente propio y respeta el `robots.txt`, pero
no hay ningún acuerdo detrás: si cambian el HTML o bloquean el bot, la app deja
de encontrar precios. El scraping se cuelga de atributos `data-*` que usa el
propio JS del sitio para trackear clics, justamente porque sobreviven a un
rediseño mejor que las clases de maquetado.

---

## Si el proyecto cambia de manos

El código es la parte fácil. Esto es lo que hay que mover o rehacer:

**Toda la capa de correo y dominio ya es del dueño de la marca** y no se mueve:
el dominio `misterprecios.com`, el WordPress que la app scrapea, el DNS y los
buzones (todo en una misma cuenta de SiteGround), y la cuenta de Resend con el
subdominio de envío verificado ahí. No se abre cuenta nueva, no se reverifica
nada y no hay que rehacer el correo sobre otro dominio.

**Cuentas que sí se mueven.** El proyecto de Supabase se puede transferir entre
organizaciones desde el dashboard; con la base vacía suele ser más simple que el
nuevo dueño cree el suyo y corra las migraciones. La API key de Gemini no se
transfiere: el nuevo dueño abre la suya. De Vercel no hay nada que mover — nunca
se desplegó.

**Rotar todas las llaves.** `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
`CRON_SECRET` porque cambian de cuenta, y `RESEND_API_KEY` aunque la cuenta no
cambie. Pasar las llaves existentes no es transferir, es compartir: mientras el
dueño anterior también las tenga, sigue con acceso total a los datos de los
clientes. Mismo criterio para las contraseñas de los buzones de SiteGround si se
compartieron.

**Sacar la identidad del dueño anterior.** Se esconde en tres lugares:

- `MAIL_CC_INTERNO` — recibe copia de **cada** correo que sale a un vendedor.
  Tiene que ser una casilla del dueño de la marca, no del operador.
- La tabla `vendedores` — revisar que ningún `email` siga apuntando a una casilla
  del dueño anterior, o esos leads no llegan al vendedor real.
- Los usuarios de Supabase Auth — dar de alta a los nuevos y **borrar los viejos**.

**Los datos de los clientes.** La tabla `leads` tiene nombre, correo y teléfono de
personas reales. Desde el formulario hay una casilla obligatoria donde el cliente
autoriza compartir sus datos **con los vendedores** — esa autorización no cubre
entregarle la base a otro operador, y los leads anteriores a la casilla tienen
`consentimiento_contacto` en `null` (que es distinto de haberla rechazado). La
opción limpia es entregar el proyecto con la base vacía; si no, revisar cómo se
maneja bajo la Ley 8968.

**El nombre.** La app se llama "Mister Precios" y el catálogo que consulta es
misterprecios.com. Si quien recibe el proyecto no es el dueño de esa marca, eso
hay que resolverlo aparte.
