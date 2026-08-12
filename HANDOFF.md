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
(Postgres + Auth + Storage) · Gemini 2.5 Flash · Resend · desplegado en Vercel.

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

Enviar y recibir son dos servicios distintos sobre el mismo dominio, y es fácil
confundirlos:

- **Enviar: Resend.** Verificar el dominio deja los registros SPF/MX en un
  subdominio (`send.<dominio>`) y el DKIM en `resend._domainkey`. Sin esos
  registros la app deja de poder enviar.
- **Recibir: reenvío externo (hoy ImprovMX, plan gratis).** MX en la raíz del
  dominio, reenviando la casilla de cotizaciones a un Gmail. Verificar el dominio
  en Resend habilita **enviar, nunca recibir**: por eso hace falta este segundo
  servicio.

Como el SPF de Resend no está en la raíz, un SPF en la raíz no colisiona con él.

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

1. El plan gratis de ImprovMX **no incluye email webhooks**, así que el camino
   más directo está cerrado. Las alternativas son leer el Gmail por IMAP, usar la
   recepción de Resend, o pagar el plan.
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

**Cuentas.** El proyecto de Supabase se puede transferir entre organizaciones
desde el dashboard. Vercel, Resend, el reenvío de correo y la API key de Gemini
no se transfieren: el nuevo dueño abre las suyas.

**Rotar todas las llaves.** `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`GEMINI_API_KEY`, `CRON_SECRET`. Pasar las llaves existentes no es transferir, es
compartir: mientras el dueño anterior también las tenga, sigue con acceso total a
los datos de los clientes.

**Sacar la identidad del dueño anterior.** Se esconde en cuatro lugares:

- `MAIL_CC_INTERNO` — recibe copia de **cada** correo que sale a un vendedor.
- La tabla `vendedores` — revisar que ningún `email` siga apuntando a una casilla
  del dueño anterior, o esos leads no llegan al vendedor real.
- Los usuarios de Supabase Auth — dar de alta a los nuevos y **borrar los viejos**.
- El dominio, en `MAIL_FROM` y `NEXT_PUBLIC_SITE_URL`. Si el dominio no se va con
  el proyecto, hay que rehacer toda la capa de correo sobre el dominio nuevo:
  verificarlo en Resend y recrear el alias de recepción.

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
