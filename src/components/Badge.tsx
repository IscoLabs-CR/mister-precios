import { infoEstado } from "@/lib/estados";

export default function Badge({ estado }: { estado: string }) {
  const info = infoEstado(estado);
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${info.clases}`}
    >
      {info.etiqueta}
    </span>
  );
}
