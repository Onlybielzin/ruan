// Modulo smoke do M0: prova que o pipeline Vitest + Stryker roda.
// Sera substituido pelos modulos reais de logica pura na F1 (parse/stringify, interpolacao, etc).

/** Soma os tamanhos (bytes UTF-8) de uma lista de strings. */
export function totalBytes(parts: string[]): number {
  let total = 0;
  for (const p of parts) {
    total += new TextEncoder().encode(p).length;
  }
  return total;
}

/** Trunca um texto para `max` caracteres, anexando reticencias se cortar. */
export function truncate(text: string, max: number): string {
  if (max < 0) throw new Error("max deve ser >= 0");
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}
