import Link from "next/link";

export default function Inicio() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-formulario flex-col justify-center px-5 py-12">
      <p className="eyebrow">Mister Precios</p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
        ¿Encontraste un precio? Dejanos buscarte uno mejor.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted">
        Contanos qué producto querés y a qué precio lo viste. Lo comparamos
        contra nuestra red de tiendas aliadas y te respondemos en un máximo de 3
        días hábiles.
      </p>
      <Link href="/solicitar" className="btn-primario mt-8">
        Pedir mi cotización
      </Link>
    </main>
  );
}
