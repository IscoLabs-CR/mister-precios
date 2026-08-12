import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { igualSeguro } from "@/lib/seguridad";
import {
  esResultadoCierre,
  esRolCierre,
  type ResultadoCierre,
  type RolCierre,
} from "@/lib/tipos";
import { registrarCierre } from "../acciones";

export const metadata: Metadata = {
  title: "Confirmar resultado — Mister Precios",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Página pública de cierre, a la que llegan los enlaces del correo de 72h.
 *
 * Acá NO se muta nada. Gmail y Outlook hacen prefetch de los enlaces de un
 * correo, así que un GET que cerrara el lead se dispararía solo, sin que nadie
 * toque nada. Esta página solo lee y muestra el botón; el cierre ocurre en el
 * POST de `registrarCierre`.
 */

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    resultado?: string;
    token?: string;
    rol?: string;
    hecho?: string;
    error?: string;
  }>;
};

/** Cómo se llama cada desenlace según a quién se le preguntó. */
const ETIQUETAS: Record<RolCierre, Record<ResultadoCierre, string>> = {
  cliente: {
    ganado: "Sí, ya compré",
    perdido: "No, no compré",
    en_proceso: "Todavía lo estoy pensando",
  },
  vendedor: {
    ganado: "Sí, se concretó",
    perdido: "No se concretó",
    en_proceso: "Sigue en negociación",
  },
};

const CONFIRMACION: Record<RolCierre, Record<ResultadoCierre, string>> = {
  cliente: {
    ganado: "¡Gracias! Nos alegra que hayas conseguido el producto.",
    perdido: "Gracias por contarnos. Nos sirve para mejorar lo que te ofrecemos.",
    en_proceso: "Perfecto, lo dejamos abierto. Podés volver a este correo cuando decidas.",
  },
  vendedor: {
    ganado: "¡Gracias! Queda registrada como venta concretada.",
    perdido: "Gracias por avisarnos. Queda registrado que no se concretó.",
    en_proceso: "Gracias. La dejamos abierta como negociación en curso.",
  },
};

const OTROS_RESULTADOS: ResultadoCierre[] = ["ganado", "en_proceso", "perdido"];

const TEXTO_INVALIDO = (
  <p className="text-sm leading-relaxed text-muted">
    El enlace está incompleto o venció. Respondé el correo que te mandamos y lo
    resolvemos a mano.
  </p>
);

export default async function CierrePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { resultado, token, rol: rolCrudo, hecho, error } = await searchParams;

  const rol: RolCierre = esRolCierre(rolCrudo) ? rolCrudo : "cliente";

  if (error === "invalido" || !token || !esResultadoCierre(resultado)) {
    return <Marco titulo="Este enlace no sirve">{TEXTO_INVALIDO}</Marco>;
  }

  const supabase = createAdminClient();
  const { data: lead, error: errorConsulta } = await supabase
    .from("leads")
    .select("id, lead_code, producto_texto, producto_normalizado, action_token, resultado_cierre")
    .eq("id", id)
    .maybeSingle();

  // Lead inexistente y token equivocado dan la misma respuesta: el enlace no
  // sirve, y no se confirma si ese lead existe.
  if (errorConsulta || !lead || !igualSeguro(token, lead.action_token as string)) {
    return <Marco titulo="Este enlace no sirve">{TEXTO_INVALIDO}</Marco>;
  }

  const producto = lead.producto_normalizado
    ? `${lead.producto_normalizado.marca} ${lead.producto_normalizado.modelo}`
    : lead.producto_texto;

  const previo = lead.resultado_cierre as ResultadoCierre | null;

  if (hecho === "1") {
    return (
      <Marco titulo="Respuesta registrada" codigo={lead.lead_code}>
        <p className="text-sm leading-relaxed text-muted">
          {CONFIRMACION[rol][resultado]}
        </p>
        <p className="mt-4 rounded-xl bg-brand-tint px-4 py-3 text-sm font-medium text-brand-deep">
          {ETIQUETAS[rol][resultado]}
        </p>
      </Marco>
    );
  }

  // Ya cerrado en firme: no se vuelve a preguntar. `en_proceso` sí se puede
  // cambiar, así que cae al formulario de abajo.
  if (previo && previo !== "en_proceso") {
    return (
      <Marco titulo="Ya tenemos tu respuesta" codigo={lead.lead_code}>
        <p className="text-sm leading-relaxed text-muted">
          Esta consulta ya quedó cerrada como{" "}
          <strong className="text-ink">{ETIQUETAS[rol][previo]}</strong>. No hace
          falta que hagas nada más.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Si te equivocaste, respondé el correo que te mandamos y lo corregimos a
          mano.
        </p>
      </Marco>
    );
  }

  const otros = OTROS_RESULTADOS.filter((otro) => otro !== resultado);

  return (
    <Marco titulo="Confirmá tu respuesta" codigo={lead.lead_code}>
      <p className="text-sm leading-relaxed text-muted">
        {rol === "cliente"
          ? "Sobre la cotización que te pasamos por"
          : "Sobre la cotización que le pasaste al cliente por"}{" "}
        <strong className="text-ink">{producto}</strong>:
      </p>

      {error === "fallo" && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-alerta-tint px-4 py-3 text-sm text-alerta"
        >
          No pudimos registrar tu respuesta. Probá de nuevo en un momento.
        </p>
      )}

      <form action={registrarCierre} className="mt-5">
        <input type="hidden" name="leadId" value={lead.id} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="rol" value={rol} />
        <button
          type="submit"
          name="resultado"
          value={resultado}
          className="btn-primario"
        >
          {ETIQUETAS[rol][resultado]}
        </button>
      </form>

      <div className="mt-6 border-t border-line pt-4">
        <p className="text-xs text-muted">¿Elegiste mal? Cambialo acá:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {otros.map((otro) => (
            <a
              key={otro}
              href={`/cierre/${lead.id}?resultado=${otro}&token=${encodeURIComponent(token)}&rol=${rol}`}
              className="rounded-xl border border-line px-4 py-2 text-sm text-ink hover:border-brand/50"
            >
              {ETIQUETAS[rol][otro]}
            </a>
          ))}
        </div>
      </div>
    </Marco>
  );
}

function Marco({
  titulo,
  codigo,
  children,
}: {
  titulo: string;
  codigo?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-formulario px-4 py-12 sm:px-5 sm:py-16">
      <div className="card">
        <p className="eyebrow">Mister Precios</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight">{titulo}</h1>
        {codigo && (
          <p className="mt-1 text-xs text-muted">Código de seguimiento: {codigo}</p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </main>
  );
}
