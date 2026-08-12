"use client";

import { useRef, useState } from "react";
import { comprimirImagen } from "@/lib/imagen";
import {
  CATEGORIAS_PRODUCTO,
  ETIQUETA_CATEGORIA,
  esCategoriaProducto,
} from "@/lib/tipos";
import {
  MAX_BYTES_FOTO,
  TIPOS_IMAGEN,
  aNumero,
  esEmailValido,
  esTelefonoValido,
  esUrlValida,
  normalizarTexto,
} from "@/lib/validacion";

const MENSAJE_CONFIRMACION =
  "Danos la oportunidad de buscarte un mejor precio en nuestra red de tiendas aliadas. Vamos a analizar la información de tu producto y esperamos tenerte una respuesta en un máximo de 3 días hábiles. Si por alguna razón nos atrasamos, te avisamos de inmediato.";

type Errores = Record<string, string>;

/** Para mostrarle al cliente cuánto pesa lo que va a subir. */
function enMegas(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SolicitudForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [leadCode, setLeadCode] = useState<string | null>(null);

  /**
   * Validación de cortesía para que el usuario no espere un round trip por un
   * campo vacío. El servidor revalida todo: acá nada es autoridad.
   */
  function validar(datos: FormData): Errores {
    const nuevos: Errores = {};

    const nombre = normalizarTexto(datos.get("nombre"));
    if (nombre.length < 3) nuevos.nombre = "Escribí tu nombre completo.";

    const email = normalizarTexto(datos.get("email"));
    if (!esEmailValido(email)) nuevos.email = "Revisá el correo electrónico.";

    const telefono = normalizarTexto(datos.get("telefono"));
    if (!esTelefonoValido(telefono))
      nuevos.telefono = "Escribí un teléfono válido (mínimo 8 dígitos).";

    if (!esCategoriaProducto(datos.get("categoria")))
      nuevos.categoria = "Elegí el tipo de producto que buscás.";

    const producto = normalizarTexto(datos.get("producto_texto"));
    if (producto.length < 3)
      nuevos.producto_texto = "Contanos qué producto buscás.";

    const link = normalizarTexto(datos.get("link_referencia"));
    if (link && !esUrlValida(link))
      nuevos.link_referencia = "El link tiene que empezar con http:// o https://";

    if (!link && !foto)
      nuevos.referencia = "Necesitamos un link de referencia o una foto.";

    const precio = aNumero(datos.get("precio_visto"));
    if (precio === null || precio <= 0)
      nuevos.precio_visto = "Escribí el precio que viste.";

    if (!datos.get("flexible"))
      nuevos.flexible = "Elegí una de las dos opciones.";

    if (datos.get("consentimiento_contacto") !== "true")
      nuevos.consentimiento_contacto =
        "Necesitamos tu autorización para poder buscarte el precio.";

    return nuevos;
  }

  function anotarErrorFoto(mensaje: string | null) {
    setErrores((previos) => {
      const resto = { ...previos };
      delete resto.fotos;
      delete resto.referencia;
      return mensaje ? { ...resto, fotos: mensaje } : resto;
    });
  }

  /**
   * El tamaño se valida DESPUÉS de comprimir, no antes: una foto de celular de
   * 7 MB es perfectamente válida, lo que importa es cuánto pesa lo que se sube.
   */
  async function alElegirFoto(event: React.ChangeEvent<HTMLInputElement>) {
    const elegida = event.target.files?.[0] ?? null;

    if (!elegida) {
      setFoto(null);
      anotarErrorFoto(null);
      return;
    }

    if (!(TIPOS_IMAGEN as readonly string[]).includes(elegida.type)) {
      setFoto(null);
      anotarErrorFoto("La foto tiene que ser JPG, PNG o WebP.");
      return;
    }

    setPreparandoFoto(true);
    try {
      const lista = await comprimirImagen(elegida);

      if (lista.size > MAX_BYTES_FOTO) {
        setFoto(null);
        anotarErrorFoto(
          `La foto sigue pesando ${enMegas(lista.size)} después de optimizarla. Probá con otra.`,
        );
        return;
      }

      setFoto(lista);
      anotarErrorFoto(null);
    } finally {
      setPreparandoFoto(false);
    }
  }

  async function alEnviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorGeneral(null);

    const datos = new FormData(event.currentTarget);
    const problemas = validar(datos);

    if (Object.keys(problemas).length > 0) {
      setErrores(problemas);
      // Llevar el foco al primer campo con problema: en móvil el error puede
      // quedar fuera de pantalla.
      const primero = Object.keys(problemas)[0];
      formRef.current
        ?.querySelector<HTMLElement>(`[name="${primero}"]`)
        ?.focus();
      return;
    }

    setErrores({});
    setEnviando(true);

    // La foto se adjunta acá y no desde el input porque lo que se sube es la
    // versión COMPRIMIDA, no el archivo que el cliente eligió.
    datos.delete("fotos");
    if (foto) datos.append("fotos", foto);

    try {
      const respuesta = await fetch("/api/leads", {
        method: "POST",
        body: datos,
      });

      const cuerpo = (await respuesta.json()) as {
        ok?: boolean;
        lead_code?: string;
        error?: string;
      };

      if (!respuesta.ok || !cuerpo.ok || !cuerpo.lead_code) {
        setErrorGeneral(
          cuerpo.error ?? "No pudimos registrar tu solicitud. Intentá de nuevo.",
        );
        return;
      }

      setLeadCode(cuerpo.lead_code);
    } catch {
      setErrorGeneral(
        "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  if (leadCode) {
    return (
      <div className="card" role="status">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-tint text-xl text-brand">
          ✓
        </div>
        <h2 className="mt-4 text-xl font-semibold">¡Solicitud recibida!</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink">
          {MENSAJE_CONFIRMACION}
        </p>
        <p className="mt-5 rounded-xl bg-brand-tint px-4 py-3 text-sm text-brand-deep">
          Tu código de seguimiento es{" "}
          <strong className="font-semibold">{leadCode}</strong>. Guardalo por si
          nos escribís.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={alEnviar} noValidate className="card">
      {/* Honeypot: invisible para personas, irresistible para bots. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="empresa">Empresa</label>
        <input id="empresa" name="empresa" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="space-y-5">
        <Campo
          id="nombre"
          etiqueta="Nombre completo"
          error={errores.nombre}
          autoComplete="name"
          placeholder="María Rodríguez"
        />

        <Campo
          id="email"
          etiqueta="Correo electrónico"
          tipo="email"
          error={errores.email}
          autoComplete="email"
          inputMode="email"
          placeholder="maria@correo.com"
        />

        <Campo
          id="telefono"
          etiqueta="Teléfono"
          tipo="tel"
          error={errores.telefono}
          autoComplete="tel"
          inputMode="tel"
          placeholder="8888 8888"
        />

        <div>
          <label htmlFor="categoria" className="etiqueta">
            Tipo de producto
          </label>
          <select
            id="categoria"
            name="categoria"
            defaultValue=""
            className={`campo ${errores.categoria ? "campo-error" : ""}`}
            aria-invalid={Boolean(errores.categoria)}
            aria-describedby={errores.categoria ? "categoria-error" : undefined}
          >
            <option value="" disabled>
              Elegí una opción
            </option>
            {CATEGORIAS_PRODUCTO.map((categoria) => (
              <option key={categoria} value={categoria}>
                {ETIQUETA_CATEGORIA[categoria]}
              </option>
            ))}
          </select>
          {errores.categoria && (
            <span id="categoria-error" className="mensaje-error" role="alert">
              {errores.categoria}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="producto_texto" className="etiqueta">
            Producto y modelo
          </label>
          <textarea
            id="producto_texto"
            name="producto_texto"
            rows={3}
            className={`campo resize-y ${errores.producto_texto ? "campo-error" : ""}`}
            placeholder="Televisor Samsung QN65Q80D de 65 pulgadas"
            aria-invalid={Boolean(errores.producto_texto)}
            aria-describedby={
              errores.producto_texto ? "producto_texto-error" : "producto_texto-ayuda"
            }
          />
          {errores.producto_texto ? (
            <span id="producto_texto-error" className="mensaje-error" role="alert">
              {errores.producto_texto}
            </span>
          ) : (
            <span id="producto_texto-ayuda" className="ayuda">
              Entre más específico, mejor. Si sabés el código del modelo, incluilo.
            </span>
          )}
        </div>

        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-medium text-ink">
            Referencia del precio
          </legend>
          <p className="ayuda !mt-0 mb-3">
            Necesitamos al menos una de las dos: el link donde lo viste o una
            foto del producto.
          </p>

          <Campo
            id="link_referencia"
            etiqueta="Link de referencia"
            tipo="url"
            error={errores.link_referencia}
            inputMode="url"
            placeholder="https://tienda.com/producto"
            opcional
          />

          <div className="mt-4">
            <label htmlFor="fotos" className="etiqueta">
              Foto del producto{" "}
              <span className="font-normal text-muted">(opcional)</span>
            </label>
            <input
              id="fotos"
              name="fotos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={alElegirFoto}
              disabled={preparandoFoto || enviando}
              className="w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-tint file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-brand-deep disabled:opacity-60"
              aria-describedby="fotos-ayuda"
            />

            {preparandoFoto && (
              <p className="mt-2 text-xs text-muted" role="status">
                Optimizando la foto…
              </p>
            )}

            {foto && !preparandoFoto && (
              <p className="mt-2 truncate text-xs text-muted">
                {foto.name} — {enMegas(foto.size)}
              </p>
            )}

            {errores.fotos ? (
              <span className="mensaje-error" role="alert">
                {errores.fotos}
              </span>
            ) : (
              <span id="fotos-ayuda" className="ayuda">
                Una imagen JPG, PNG o WebP. Si se ve la etiqueta o la caja con el
                modelo, mejor: de ahí sacamos el código exacto.
              </span>
            )}
          </div>

          {errores.referencia && (
            <span className="mensaje-error" role="alert">
              {errores.referencia}
            </span>
          )}
        </fieldset>

        <div>
          <label htmlFor="precio_visto" className="etiqueta">
            Mejor precio que viste
          </label>
          <div className="flex gap-2">
            <input
              id="precio_visto"
              name="precio_visto"
              type="text"
              inputMode="decimal"
              placeholder="685 000"
              className={`campo flex-1 ${errores.precio_visto ? "campo-error" : ""}`}
              aria-invalid={Boolean(errores.precio_visto)}
              aria-describedby={errores.precio_visto ? "precio_visto-error" : undefined}
            />
            <select
              name="moneda"
              defaultValue="CRC"
              aria-label="Moneda"
              className="campo w-28 flex-none"
            >
              <option value="CRC">₡ CRC</option>
              <option value="USD">$ USD</option>
            </select>
          </div>
          {errores.precio_visto && (
            <span id="precio_visto-error" className="mensaje-error" role="alert">
              {errores.precio_visto}
            </span>
          )}
        </div>

        <fieldset>
          <legend className="etiqueta">¿Qué tan flexible sos?</legend>
          <div className="mt-1 space-y-2">
            <label className="opcion">
              <input
                type="radio"
                name="flexible"
                value="false"
                className="mt-0.5 h-4 w-4 flex-none accent-brand"
              />
              <span>
                <span className="block text-sm font-medium">Solo este modelo</span>
                <span className="block text-xs text-muted">
                  Buscamos exactamente el producto que indicaste.
                </span>
              </span>
            </label>
            <label className="opcion">
              <input
                type="radio"
                name="flexible"
                value="true"
                className="mt-0.5 h-4 w-4 flex-none accent-brand"
              />
              <span>
                <span className="block text-sm font-medium">
                  Abierto a opciones similares
                </span>
                <span className="block text-xs text-muted">
                  Podemos ofrecerte alternativas parecidas si conviene más.
                </span>
              </span>
            </label>
          </div>
          {errores.flexible && (
            <span className="mensaje-error" role="alert">
              {errores.flexible}
            </span>
          )}
        </fieldset>

        {/* Sin esta autorización el lead no le sirve a nadie: todo el flujo
            consiste en pasarle los datos del cliente a una tienda aliada. */}
        <div>
          <label
            className={`opcion ${errores.consentimiento_contacto ? "border-alerta" : ""}`}
          >
            <input
              type="checkbox"
              name="consentimiento_contacto"
              value="true"
              className="mt-0.5 h-4 w-4 flex-none accent-brand"
              aria-invalid={Boolean(errores.consentimiento_contacto)}
              aria-describedby={
                errores.consentimiento_contacto
                  ? "consentimiento_contacto-error"
                  : undefined
              }
            />
            <span>
              <span className="block text-sm font-medium">
                Autorizo que compartan mi información con los vendedores
              </span>
              <span className="block text-xs text-muted">
                Le pasamos tu nombre, correo y teléfono a las tiendas aliadas
                que puedan cotizarte este producto, para que te contacten con
                su mejor precio.
              </span>
            </span>
          </label>
          {errores.consentimiento_contacto && (
            <span
              id="consentimiento_contacto-error"
              className="mensaje-error"
              role="alert"
            >
              {errores.consentimiento_contacto}
            </span>
          )}
        </div>
      </div>

      {errorGeneral && (
        <p
          className="mt-5 rounded-xl bg-alerta-tint px-4 py-3 text-sm text-alerta"
          role="alert"
        >
          {errorGeneral}
        </p>
      )}

      <button
        type="submit"
        className="btn-primario mt-6"
        disabled={enviando || preparandoFoto}
      >
        {enviando ? "Enviando…" : "Buscarme un mejor precio"}
      </button>
    </form>
  );
}

function Campo({
  id,
  etiqueta,
  error,
  tipo = "text",
  opcional = false,
  ...resto
}: {
  id: string;
  etiqueta: string;
  error?: string;
  tipo?: string;
  opcional?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="etiqueta">
        {etiqueta}
        {opcional && <span className="font-normal text-muted"> (opcional)</span>}
      </label>
      <input
        id={id}
        name={id}
        type={tipo}
        className={`campo ${error ? "campo-error" : ""}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...resto}
      />
      {error && (
        <span id={`${id}-error`} className="mensaje-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
