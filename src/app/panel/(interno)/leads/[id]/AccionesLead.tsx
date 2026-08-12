"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  asignarVendedor,
  cargarCotizacion,
  enviarResumen,
  generarBorrador,
  guardarBorrador,
  leerCotizacion,
  vincularCotizacion,
  type Resultado,
} from "@/app/panel/acciones";
import type { Vendedor } from "@/lib/tipos";
import type { Cotizacion } from "@/lib/panel/consultas";
import { formatearFechaCR } from "@/lib/formato";
import {
  MAX_BYTES_COTIZACION,
  MAX_LARGO_RESUMEN,
  MIN_LARGO_RESUMEN,
} from "@/lib/validacion";

function Aviso({ resultado }: { resultado: Resultado | null }) {
  if (!resultado) return null;
  return (
    <p
      role="alert"
      className={`mt-3 rounded-xl px-4 py-3 text-sm ${
        resultado.ok
          ? "bg-brand-tint text-brand-deep"
          : "bg-alerta-tint text-alerta"
      }`}
    >
      {resultado.ok ? resultado.mensaje : resultado.error}
    </p>
  );
}

export function AsignarVendedor({
  leadId,
  vendedores,
  vendedorActual,
}: {
  leadId: string;
  vendedores: Vendedor[];
  vendedorActual: string | null;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [elegido, setElegido] = useState(vendedorActual ?? "");

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={elegido}
          onChange={(e) => setElegido(e.target.value)}
          aria-label="Vendedor"
          className="campo flex-1"
        >
          <option value="">Elegí un vendedor…</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.id}>
              {v.nombre_tienda}
              {v.nombre_contacto ? ` — ${v.nombre_contacto}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!elegido || pendiente || elegido === vendedorActual}
          onClick={() =>
            iniciar(async () => {
              setResultado(await asignarVendedor(leadId, elegido));
              router.refresh();
            })
          }
          className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/85 disabled:opacity-50 sm:w-auto"
        >
          {pendiente ? "Asignando…" : "Asignar"}
        </button>
      </div>
      <Aviso resultado={resultado} />
    </div>
  );
}

/**
 * Borrador del correo: se genera con IA, se corrige a mano y recién ahí se
 * manda.
 *
 * El detalle que sostiene todo: `enviarResumen` manda lo que está GUARDADO en
 * la base, no lo que se ve en pantalla. Por eso el botón de enviar se bloquea
 * mientras haya cambios sin guardar — si no, una corrección tipeada y no
 * guardada se perdería en silencio y el cliente recibiría el texto viejo.
 */
export function BorradorCorreo({
  leadId,
  borradorInicial,
  actualizadoEn,
  vendedor,
  emailCliente,
  yaEnviado,
}: {
  leadId: string;
  borradorInicial: string;
  /** Ya formateado en el servidor: `formatearFechaCR` no es seguro en cliente. */
  actualizadoEn: string | null;
  vendedor: { nombre_tienda: string; email: string } | null;
  emailCliente: string;
  yaEnviado: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(borradorInicial);
  const [guardado, setGuardado] = useState(borradorInicial);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const [generando, iniciarGeneracion] = useTransition();
  const [guardando, iniciarGuardado] = useTransition();
  const [enviando, iniciarEnvio] = useTransition();
  const ocupado = generando || guardando || enviando;

  const hayCambios = texto !== guardado;
  const largoValido =
    texto.trim().length >= MIN_LARGO_RESUMEN &&
    texto.length <= MAX_LARGO_RESUMEN;

  const impedimento = !guardado.trim()
    ? "Generá el borrador antes de enviar."
    : !vendedor
      ? "Asignale un vendedor para poder enviarlo."
      : hayCambios
        ? "Tenés cambios sin guardar. Guardalos y después enviá."
        : null;

  return (
    <section className="card">
      <h2 className="text-sm font-semibold">Correo al vendedor</h2>
      <p className="ayuda !mt-1">
        Para{" "}
        <strong className="font-medium text-ink">
          {vendedor ? `${vendedor.nombre_tienda} (${vendedor.email})` : "—"}
        </strong>
        , con copia a{" "}
        <strong className="font-medium text-ink">{emailCliente}</strong>. El
        cliente lee este mismo texto, así que revisalo antes de mandarlo.
      </p>

      <div className="mt-3">
        <label htmlFor="borrador" className="text-xs text-muted">
          Resumen ejecutivo (es el párrafo de apertura; el producto, el precio a
          vencer y las fotos van abajo automáticamente)
        </label>
        <textarea
          id="borrador"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          maxLength={MAX_LARGO_RESUMEN}
          disabled={ocupado}
          placeholder="Todavía no hay borrador. Generalo con IA y corregí lo que haga falta."
          className="campo mt-1 min-h-[8rem] resize-y leading-relaxed disabled:opacity-60"
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {actualizadoEn ? `Última versión guardada: ${actualizadoEn}` : ""}
          </p>
          <p
            className={`text-xs ${hayCambios ? "font-medium text-alerta" : "text-muted"}`}
          >
            {hayCambios ? "Sin guardar · " : ""}
            {texto.length}/{MAX_LARGO_RESUMEN}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() =>
            iniciarGeneracion(async () => {
              const salida = await generarBorrador(leadId);
              setResultado(salida);
              if (salida.ok) {
                setTexto(salida.texto);
                setGuardado(salida.texto);
              }
              router.refresh();
            })
          }
          className="rounded-xl border border-line px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-50"
        >
          {generando
            ? "Generando…"
            : guardado.trim()
              ? "Regenerar con IA"
              : "Generar borrador con IA"}
        </button>

        <button
          type="button"
          disabled={ocupado || !hayCambios || !largoValido}
          onClick={() =>
            iniciarGuardado(async () => {
              const salida = await guardarBorrador(leadId, texto);
              setResultado(salida);
              if (salida.ok) setGuardado(texto);
              router.refresh();
            })
          }
          className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/85 disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar cambios"}
        </button>

        <button
          type="button"
          disabled={ocupado || impedimento !== null}
          onClick={() =>
            iniciarEnvio(async () => {
              setResultado(await enviarResumen(leadId));
              router.refresh();
            })
          }
          className="btn-primario !w-auto"
        >
          {enviando
            ? "Enviando…"
            : yaEnviado
              ? "Reenviar correo"
              : "Enviar correo"}
        </button>
      </div>

      {impedimento && <p className="ayuda">{impedimento}</p>}
      {!impedimento && yaEnviado && (
        <p className="ayuda">
          Reenviar reinicia el reloj de las 24 horas del recordatorio.
        </p>
      )}

      <Aviso resultado={resultado} />
    </section>
  );
}

/**
 * Carga a mano la cotización que contestó el vendedor.
 *
 * El documento va aparte de los campos porque es opcional: lo que mueve el lead
 * a `cotizado` es el precio. Si el PDF pesa de más, se registra igual y el
 * archivo se consigue después.
 *
 * "Leer del documento" prellena los campos con IA, pero NO guarda: lo que se
 * registra es siempre lo que quedó escrito en el formulario después de que una
 * persona lo revisó.
 */
export function CargarCotizacion({
  leadId,
  yaHayCotizacion,
}: {
  leadId: string;
  yaHayCotizacion: boolean;
}) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const [guardando, iniciarGuardado] = useTransition();
  const [leyendo, iniciarLectura] = useTransition();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Controlados para que la lectura con IA pueda rellenarlos.
  const [precio, setPrecio] = useState("");
  const [vigencia, setVigencia] = useState("");
  const [condiciones, setCondiciones] = useState("");
  const [extraccion, setExtraccion] = useState("");
  const [hayArchivo, setHayArchivo] = useState(false);

  const pendiente = guardando || leyendo;
  const maxMB = MAX_BYTES_COTIZACION / (1024 * 1024);

  function limpiar() {
    formulario.current?.reset();
    setPrecio("");
    setVigencia("");
    setCondiciones("");
    setExtraccion("");
    setHayArchivo(false);
    setAviso(null);
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold">
        {yaHayCotizacion ? "Cargar otra cotización" : "Cargar la cotización"}
      </h2>
      <p className="ayuda !mt-1">
        {yaHayCotizacion
          ? "Una cotización corregida reinicia el reloj de las 72 horas."
          : "Cuando el vendedor te conteste, anotá acá lo que cotizó. Esto pasa el lead a “Cotizado” y arranca el reloj de las 72 horas."}
      </p>

      <form
        ref={formulario}
        className="mt-3 space-y-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          const datos = new FormData(evento.currentTarget);
          iniciarGuardado(async () => {
            const salida = await cargarCotizacion(leadId, datos);
            setResultado(salida);
            if (salida.ok) limpiar();
            router.refresh();
          });
        }}
      >
        <div>
          <label htmlFor="archivo" className="text-xs text-muted">
            Documento (opcional) — PDF o foto, hasta {maxMB} MB
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id="archivo"
              name="archivo"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={pendiente}
              onChange={(e) => setHayArchivo(Boolean(e.target.files?.length))}
              className="campo flex-1 file:mr-3 file:rounded-lg file:border-0 file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
            />
            <button
              type="button"
              disabled={pendiente || !hayArchivo}
              onClick={() => {
                const form = formulario.current;
                if (!form) return;
                // Solo el archivo: la lectura no toca lo demás.
                const datos = new FormData();
                const entrada = form.elements.namedItem("archivo");
                const elegido =
                  entrada instanceof HTMLInputElement ? entrada.files?.[0] : null;
                if (!elegido) return;
                datos.set("archivo", elegido);

                iniciarLectura(async () => {
                  const salida = await leerCotizacion(datos);
                  setResultado(salida);
                  if (salida.ok) {
                    setPrecio(salida.campos.precio);
                    setVigencia(salida.campos.vigencia);
                    setCondiciones(salida.campos.condiciones);
                    setExtraccion(salida.extraccion);
                    setAviso(salida.aviso);
                  }
                });
              }}
              className="rounded-xl border border-line px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-50 sm:w-auto"
            >
              {leyendo ? "Leyendo…" : "Leer del documento"}
            </button>
          </div>
          <p className="ayuda">
            Opcional. La IA transcribe el precio y las condiciones para que no
            los tipees; siempre revisalos antes de registrar.
          </p>
        </div>

        {aviso && (
          <p className="rounded-xl bg-alerta-tint px-4 py-3 text-sm text-alerta">
            {aviso}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="precio" className="text-xs text-muted">
              Precio cotizado (colones)
            </label>
            <input
              id="precio"
              name="precio"
              type="text"
              inputMode="numeric"
              required
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              disabled={pendiente}
              placeholder="595 000"
              className="campo mt-1"
            />
          </div>

          <div>
            <label htmlFor="vigencia" className="text-xs text-muted">
              Vigencia en días (opcional)
            </label>
            <input
              id="vigencia"
              name="vigencia"
              type="text"
              inputMode="numeric"
              value={vigencia}
              onChange={(e) => setVigencia(e.target.value)}
              disabled={pendiente}
              placeholder="15"
              className="campo mt-1"
            />
          </div>
        </div>

        <div>
          <label htmlFor="condiciones" className="text-xs text-muted">
            Condiciones (opcional)
          </label>
          <textarea
            id="condiciones"
            name="condiciones"
            rows={2}
            maxLength={500}
            value={condiciones}
            onChange={(e) => setCondiciones(e.target.value)}
            disabled={pendiente}
            placeholder="Incluye instalación. Entrega en 3 días hábiles."
            className="campo mt-1 resize-y"
          />
        </div>

        {/* Viaja al submit solo para auditoría, en `extraido_por_ia`. */}
        <input type="hidden" name="extraccion" value={extraccion} />

        <button
          type="submit"
          disabled={pendiente}
          className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/85 disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Registrar cotización"}
        </button>
      </form>

      <Aviso resultado={resultado} />
    </section>
  );
}

export function VincularCotizacion({
  leadId,
  cotizaciones,
}: {
  leadId: string;
  cotizaciones: Cotizacion[];
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [elegida, setElegida] = useState("");

  if (cotizaciones.length === 0) return null;

  return (
    <div className="card mt-4 border-alerta/30">
      <h2 className="text-sm font-semibold">Cotizaciones sin asignar</h2>
      <p className="ayuda !mt-1">
        Llegaron por correo sin un código reconocible. Si alguna corresponde a
        este lead, vinculala acá.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          value={elegida}
          onChange={(e) => setElegida(e.target.value)}
          aria-label="Cotización sin asignar"
          className="campo flex-1"
        >
          <option value="">Elegí una cotización…</option>
          {cotizaciones.map((c) => (
            <option key={c.id} value={c.id}>
              {c.remitente ?? "remitente desconocido"} —{" "}
              {c.asunto ?? "sin asunto"} ({formatearFechaCR(c.created_at)})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!elegida || pendiente}
          onClick={() =>
            iniciar(async () => {
              setResultado(await vincularCotizacion(elegida, leadId));
              router.refresh();
            })
          }
          className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/85 disabled:opacity-50 sm:w-auto"
        >
          {pendiente ? "Vinculando…" : "Vincular"}
        </button>
      </div>
      <Aviso resultado={resultado} />
    </div>
  );
}
