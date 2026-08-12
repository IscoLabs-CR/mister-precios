"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearVendedor, type Resultado } from "@/app/panel/acciones";
import {
  esEmailValido,
  esTelefonoValido,
  normalizarTexto,
} from "@/lib/validacion";

type Errores = Record<string, string>;

const VACIO = { empresa: "", nombre: "", email: "", telefono: "" };

export default function NuevoVendedor() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pendiente, iniciar] = useTransition();
  const [valores, setValores] = useState(VACIO);
  const [errores, setErrores] = useState<Errores>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);

  /**
   * Validación de cortesía para no gastar un round trip en un campo vacío. La
   * Server Action revalida todo: acá nada es autoridad.
   */
  function validar(): Errores {
    const nuevos: Errores = {};

    if (normalizarTexto(valores.empresa).length < 2)
      nuevos.empresa = "Escribí el nombre de la empresa.";

    if (normalizarTexto(valores.nombre).length < 3)
      nuevos.nombre = "Escribí el nombre del contacto.";

    if (!esEmailValido(normalizarTexto(valores.email)))
      nuevos.email = "Revisá el correo electrónico.";

    const telefono = normalizarTexto(valores.telefono);
    if (telefono && !esTelefonoValido(telefono))
      nuevos.telefono = "Escribí un teléfono válido (mínimo 8 dígitos).";

    return nuevos;
  }

  function alEnviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResultado(null);

    const problemas = validar();
    if (Object.keys(problemas).length > 0) {
      setErrores(problemas);
      const primero = Object.keys(problemas)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${primero}"]`)?.focus();
      return;
    }

    setErrores({});
    iniciar(async () => {
      const respuesta = await crearVendedor(valores);
      setResultado(respuesta);
      if (respuesta.ok) {
        setValores(VACIO);
        router.refresh();
      }
    });
  }

  function alEscribir(campo: keyof typeof VACIO) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const valor = event.target.value;
      setValores((previos) => ({ ...previos, [campo]: valor }));
      setErrores((previos) => {
        if (!previos[campo]) return previos;
        const resto = { ...previos };
        delete resto[campo];
        return resto;
      });
    };
  }

  return (
    <form ref={formRef} onSubmit={alEnviar} noValidate className="card">
      <h2 className="text-sm font-semibold">Agregar vendedor</h2>
      <p className="ayuda !mt-1">
        El nombre de la empresa tiene que escribirse igual que en el catálogo:
        así los leads de esa tienda se le asignan solos.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo
          id="empresa"
          etiqueta="Empresa"
          valor={valores.empresa}
          alCambiar={alEscribir("empresa")}
          error={errores.empresa}
          placeholder="Monge"
          autoComplete="organization"
        />

        <Campo
          id="nombre"
          etiqueta="Nombre del contacto"
          valor={valores.nombre}
          alCambiar={alEscribir("nombre")}
          error={errores.nombre}
          placeholder="María Rodríguez"
          autoComplete="name"
        />

        <Campo
          id="email"
          etiqueta="Correo"
          tipo="email"
          valor={valores.email}
          alCambiar={alEscribir("email")}
          error={errores.email}
          placeholder="ventas@monge.cr"
          autoComplete="email"
          inputMode="email"
        />

        <Campo
          id="telefono"
          etiqueta="Teléfono"
          tipo="tel"
          valor={valores.telefono}
          alCambiar={alEscribir("telefono")}
          error={errores.telefono}
          placeholder="8888 8888"
          autoComplete="tel"
          inputMode="tel"
          opcional
        />
      </div>

      <p className="ayuda">
        A este correo le llegan los resúmenes ejecutivos de cada lead asignado.
      </p>

      <button type="submit" className="btn-primario mt-5 sm:!w-auto" disabled={pendiente}>
        {pendiente ? "Guardando…" : "Agregar vendedor"}
      </button>

      {resultado && (
        <p
          role="alert"
          className={`mt-4 rounded-xl px-4 py-3 text-sm ${
            resultado.ok
              ? "bg-brand-tint text-brand-deep"
              : "bg-alerta-tint text-alerta"
          }`}
        >
          {resultado.ok ? resultado.mensaje : resultado.error}
        </p>
      )}
    </form>
  );
}

function Campo({
  id,
  etiqueta,
  valor,
  alCambiar,
  error,
  tipo = "text",
  opcional = false,
  ...resto
}: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
        value={valor}
        onChange={alCambiar}
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
