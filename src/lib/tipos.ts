// Estados del lead. Enum de texto controlado: el `check` en Postgres y esta
// lista tienen que moverse juntos.
export const ESTADOS = [
  "nuevo",
  "validado",
  "vendedor_no_asignado",
  "enviado_vendedor",
  "cotizado",
  "en_proceso",
  "cerrado_ganado",
  "cerrado_perdido",
  "sin_asignar",
] as const;

export type Estado = (typeof ESTADOS)[number];

export const MONEDAS = ["CRC", "USD"] as const;
export type Moneda = (typeof MONEDAS)[number];

/**
 * Categorías que el cliente elige en el formulario. Mismo criterio que los
 * estados: texto controlado, y esta lista, el `check` en Postgres y el <select>
 * se mueven juntos.
 *
 * Lo que se guarda es el slug, no la etiqueta: así se puede reescribir cómo se
 * lee en pantalla sin migrar filas ni tocar el `check`.
 */
export const CATEGORIAS_PRODUCTO = [
  "refrigeradoras",
  "cocinas",
  "pantallas_tv",
  "consolas_videojuegos",
  "laptops",
  "celulares",
  "secadoras",
  "hornos",
  "lavaplatos",
  "congeladores",
  "plantillas",
  "aires_acondicionados",
  "freidoras_aire",
] as const;

export type CategoriaProducto = (typeof CATEGORIAS_PRODUCTO)[number];

/** Orden de la lista = orden del <select>. */
export const ETIQUETA_CATEGORIA: Record<CategoriaProducto, string> = {
  refrigeradoras: "Refrigeradoras",
  cocinas: "Cocinas",
  pantallas_tv: "Pantallas de TV",
  consolas_videojuegos: "Consolas de videojuegos",
  laptops: "Laptops",
  celulares: "Celulares",
  secadoras: "Secadoras",
  hornos: "Hornos",
  lavaplatos: "Lavaplatos",
  congeladores: "Congeladores",
  plantillas: "Plantillas",
  aires_acondicionados: "Aires acondicionados",
  freidoras_aire: "Freidoras de aire",
};

export function esCategoriaProducto(valor: unknown): valor is CategoriaProducto {
  return (
    typeof valor === "string" &&
    (CATEGORIAS_PRODUCTO as readonly string[]).includes(valor)
  );
}

export const RESULTADOS_CIERRE = ["ganado", "perdido", "en_proceso"] as const;
export type ResultadoCierre = (typeof RESULTADOS_CIERRE)[number];

/** Quién recibió el enlace de cierre. Viaja en la URL del correo de 72h para
 *  poder atribuir la respuesta: el `action_token` identifica al lead, no a la
 *  persona, y el mismo enlace le sirve a los dos. */
export const ROLES_CIERRE = ["cliente", "vendedor"] as const;
export type RolCierre = (typeof ROLES_CIERRE)[number];

// Los dos llegan como texto crudo desde una URL pública, así que se validan en
// la página y otra vez en la Server Action.
export function esResultadoCierre(valor: unknown): valor is ResultadoCierre {
  return (
    typeof valor === "string" &&
    (RESULTADOS_CIERRE as readonly string[]).includes(valor)
  );
}

export function esRolCierre(valor: unknown): valor is RolCierre {
  return (
    typeof valor === "string" && (ROLES_CIERRE as readonly string[]).includes(valor)
  );
}

export type ProductoNormalizado = {
  marca: string;
  modelo: string;
  variante: string | null;
};

export type Vendedor = {
  id: string;
  nombre_tienda: string;
  nombre_contacto: string | null;
  email: string;
  telefono: string | null;
  categoria: string | null;
  id_catalogo: string | null;
  activo: boolean;
  created_at: string;
};

export type Lead = {
  id: string;
  lead_code: string;
  nombre: string;
  email: string;
  telefono: string | null;
  /** null en los leads anteriores a que el campo existiera; hoy es obligatorio. */
  categoria: CategoriaProducto | null;
  producto_texto: string;
  producto_normalizado: ProductoNormalizado | null;
  link_referencia: string | null;
  /** Rutas dentro del bucket `leads-fotos`, no URLs públicas. */
  fotos_urls: string[];
  precio_visto: number | null;
  moneda: Moneda;
  flexible: boolean;
  /**
   * Autorización explícita para compartir los datos con los vendedores aliados.
   * `true` en todo lead nuevo (sin la casilla no se puede enviar) y `null` en
   * los anteriores, que es distinto de haberla rechazado.
   */
  consentimiento_contacto: boolean | null;
  estado: Estado;
  tienda_candidata: string | null;
  vendedor_id: string | null;
  precio_a_vencer: number | null;
  /** Resumen ejecutivo aprobado en el panel. Sin esto no se puede enviar. */
  resumen_borrador: string | null;
  resumen_borrador_at: string | null;
  action_token: string;
  fecha_enviado_vendedor: string | null;
  recordatorio_24h_enviado: boolean;
  fecha_cotizacion_recibida: string | null;
  fecha_verificacion_enviada: string | null;
  resultado_cierre: ResultadoCierre | null;
  created_at: string;
};
