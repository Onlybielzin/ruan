// F6 — Logica PURA do editor de headers (alvo de mutation testing).
// Sem React, sem store: apenas listas de nomes comuns e helpers de
// normalizacao/filtragem. O componente Headers.tsx consome estas funcoes.

/**
 * Nomes de header HTTP comuns para o autocomplete. Mantidos na forma
 * canonica (Train-Case) que e a convencao usual nos exemplos de API.
 * Lista enxuta porem abrangente (request + alguns de resposta uteis).
 */
export const HEADER_NAMES_COMUNS: readonly string[] = [
  "Accept",
  "Accept-Charset",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Connection",
  "Content-Disposition",
  "Content-Encoding",
  "Content-Language",
  "Content-Length",
  "Content-Type",
  "Cookie",
  "DNT",
  "Date",
  "ETag",
  "Expect",
  "Forwarded",
  "From",
  "Host",
  "If-Match",
  "If-Modified-Since",
  "If-None-Match",
  "If-Range",
  "If-Unmodified-Since",
  "Origin",
  "Pragma",
  "Proxy-Authorization",
  "Range",
  "Referer",
  "TE",
  "Trailer",
  "Transfer-Encoding",
  "Upgrade",
  "User-Agent",
  "Via",
  "Warning",
  "X-Api-Key",
  "X-CSRF-Token",
  "X-Forwarded-For",
  "X-Forwarded-Host",
  "X-Forwarded-Proto",
  "X-Requested-With",
];

/**
 * Normaliza um nome de header: remove espacos das pontas. Nomes de header sao
 * case-insensitive (RFC 7230), entao NAO mudamos a caixa aqui — preservamos o
 * que o usuario digitou. Use `mesmoHeader` para comparar dois nomes.
 * LOGICA PURA.
 */
export function normalizarNomeHeader(nome: string): string {
  return nome.trim();
}

/**
 * Compara dois nomes de header de forma case-insensitive, ignorando espacos
 * das pontas. Ex: " content-type " e "Content-Type" => true. LOGICA PURA.
 */
export function mesmoHeader(a: string, b: string): boolean {
  return normalizarNomeHeader(a).toLowerCase() === normalizarNomeHeader(b).toLowerCase();
}

/**
 * Filtra os nomes comuns por prefixo case-insensitive. Regras:
 * - prefixo vazio (apos trim) => retorna a lista inteira (em ordem);
 * - match e por prefixo (startsWith), case-insensitive;
 * - exclui da sugestao um nome identico ao prefixo (ja digitado por completo),
 *   pra nao oferecer o que o usuario ja escreveu inteiro.
 * Retorna um novo array (nao muta a lista base). LOGICA PURA.
 */
export function filtrarSugestoes(
  prefixo: string,
  nomes: readonly string[] = HEADER_NAMES_COMUNS,
): string[] {
  const p = normalizarNomeHeader(prefixo).toLowerCase();
  if (p.length === 0) {
    return [...nomes];
  }
  return nomes.filter((nome) => {
    const n = nome.toLowerCase();
    return n.startsWith(p) && n !== p;
  });
}

/**
 * True se o nome (normalizado) bate, case-insensitive, com algum header comum.
 * Util pra UI marcar um header digitado como "conhecido". LOGICA PURA.
 */
export function eHeaderConhecido(
  nome: string,
  nomes: readonly string[] = HEADER_NAMES_COMUNS,
): boolean {
  return nomes.some((n) => mesmoHeader(n, nome));
}
