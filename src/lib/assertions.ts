// F13 — Runtime de testes/assertions (LOGICA PURA, alvo de mutation). O usuario
// escreve, em `request.tests`, JS que roda no FRONTEND depois de cada resposta:
//   test('nome', () => { expect(res.status).toBe(200); });
//
// API exposta ao codigo de teste:
//   test(nome, fn)  -> registra um teste; a `fn` roda imediatamente, e se lancar
//                      (uma assertion falha lanca) o teste e marcado como falho.
//   expect(valor)   -> objeto com matchers .toBe/.toEqual/.toBeTruthy/.toBeFalsy/
//                      .toContain/.toHaveProperty/.toBeGreaterThan/.toBeLessThan
//                      (e os respectivos .not.*).
//   res             -> ResponseData da ultima resposta (status, body, headers...).
//   ruan            -> mesma API de variaveis dos scripts (getVar/getEnvVar...).
//   console.*       -> capturado (nao escreve no console real).
//
// `rodarTestes(codigo, res, ruan)` devolve `{ resultados }` — um array com o
// nome de cada teste e se passou (com a mensagem de erro quando falha). NUNCA
// lanca: erro de sintaxe / fora de `test()` vira um pseudo-resultado falho, para
// a UI nunca quebrar.
//
// SEGURANCA: mesma sandbox leve do scripting (new Function + nomes do ambiente
// mascarados como undefined). O usuario roda os PROPRIOS testes.

import { formatarLinha } from "./scripting";
import type { RuanApi } from "./scripting";
// Re-exporta o tipo para quem consome a API de testes (ex.: TestsPanel/tests)
// poder tipar o `ruan` sem alcancar o modulo scripting diretamente.
export type { RuanApi };

/** Resultado de um unico `test(...)`. */
export interface ResultadoTeste {
  /** Nome passado em test(nome, fn). */
  nome: string;
  /** true se a fn rodou sem lancar; false se alguma assertion (ou a fn) falhou. */
  passou: boolean;
  /** Mensagem de erro quando `passou === false`; ausente quando passou. */
  erro?: string;
}

/** Retorno de `rodarTestes`. */
export interface ResultadoTestes {
  /** Um item por `test(...)` registrado, na ordem de registro. */
  resultados: ResultadoTeste[];
  /** Linhas capturadas de console.* durante a execucao. */
  logs: string[];
}

/** Erro lancado por um matcher que falhou (distinto de um erro arbitrario). */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

// Nomes do ambiente mascarados no escopo do codigo de teste (igual ao scripting).
// NAO inclua palavras reservadas (ex: `import`) — quebrariam `new Function`.
const NOMES_BLOQUEADOS = [
  "require",
  "module",
  "exports",
  "process",
  "global",
  "globalThis",
  "window",
  "self",
  "fetch",
] as const;

/** Serializa um valor para a mensagem de erro de um matcher. PURA. */
export function descrever(valor: unknown): string {
  if (typeof valor === "string") return JSON.stringify(valor);
  if (valor === undefined) return "undefined";
  if (valor === null) return "null";
  if (typeof valor === "bigint") return `${valor.toString()}n`;
  if (typeof valor === "function") return "[Function]";
  if (typeof valor === "object") {
    try {
      return JSON.stringify(valor);
    } catch {
      return String(valor);
    }
  }
  return String(valor);
}

/**
 * Igualdade profunda estrutural usada por `.toEqual`. Compara primitivos por
 * `Object.is` (NaN === NaN, distingue +0/-0), arrays e objetos planos campo a
 * campo (mesmas chaves, mesmos valores recursivamente). PURA.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;

  const arrA = Array.isArray(a);
  const arrB = Array.isArray(b);
  if (arrA !== arrB) return false;

  if (arrA && arrB) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Testa se `alvo` "contem" `item` (string substring ou array membro). PURA. */
export function contem(alvo: unknown, item: unknown): boolean {
  if (typeof alvo === "string") {
    return alvo.includes(String(item));
  }
  if (Array.isArray(alvo)) {
    return alvo.some((el) => deepEqual(el, item));
  }
  return false;
}

/** Acessa uma propriedade aninhada por caminho ("a.b.c"). PURA. */
export function temPropriedade(
  alvo: unknown,
  caminho: string,
): { existe: boolean; valor: unknown } {
  if (alvo === null || alvo === undefined) return { existe: false, valor: undefined };
  const partes = String(caminho).split(".");
  let atual: unknown = alvo;
  for (const parte of partes) {
    if (atual === null || atual === undefined) {
      return { existe: false, valor: undefined };
    }
    if (
      typeof atual !== "object" ||
      !Object.prototype.hasOwnProperty.call(atual, parte)
    ) {
      // Arrays: indice numerico tambem conta como propriedade.
      if (
        Array.isArray(atual) &&
        Object.prototype.hasOwnProperty.call(atual, parte)
      ) {
        atual = (atual as unknown as Record<string, unknown>)[parte];
        continue;
      }
      return { existe: false, valor: undefined };
    }
    atual = (atual as Record<string, unknown>)[parte];
  }
  return { existe: true, valor: atual };
}

/** Shape do objeto retornado por `expect(valor)` (e seu `.not`). PURA. */
export interface Matchers {
  toBe(esperado: unknown): void;
  toEqual(esperado: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(item: unknown): void;
  toHaveProperty(caminho: string, valor?: unknown): void;
  toBeGreaterThan(n: number): void;
  toBeLessThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThanOrEqual(n: number): void;
}

export interface Expectation extends Matchers {
  /** Inverte o sentido de cada matcher. */
  not: Matchers;
}

/**
 * Constroi o objeto de matchers de `expect(real)`. `negado` inverte a logica:
 * cada matcher lanca AssertionError quando a condicao (ja considerando `negado`)
 * nao bate. LOGICA PURA — nucleo das assertions, alvo principal de mutation.
 */
export function criarExpect(real: unknown, negado = false): Matchers {
  // Lanca/nao-lanca conforme `condicao` E `negado`. `msg` descreve o caso
  // POSITIVO (sem negacao); ao negar, prefixamos "not." na mensagem.
  const checar = (condicao: boolean, msg: string, msgNeg: string) => {
    if (negado) {
      if (condicao) throw new AssertionError(msgNeg);
    } else {
      if (!condicao) throw new AssertionError(msg);
    }
  };

  const exigirNumero = (v: unknown, matcher: string): number => {
    if (typeof v !== "number") {
      throw new AssertionError(
        `${matcher}: esperado numero, recebido ${descrever(v)}`,
      );
    }
    return v;
  };

  return {
    toBe(esperado) {
      checar(
        Object.is(real, esperado),
        `esperado ${descrever(real)} === ${descrever(esperado)}`,
        `esperado ${descrever(real)} !== ${descrever(esperado)}`,
      );
    },
    toEqual(esperado) {
      checar(
        deepEqual(real, esperado),
        `esperado ${descrever(real)} equivalente a ${descrever(esperado)}`,
        `esperado ${descrever(real)} NAO equivalente a ${descrever(esperado)}`,
      );
    },
    toBeTruthy() {
      checar(
        Boolean(real),
        `esperado ${descrever(real)} ser truthy`,
        `esperado ${descrever(real)} ser falsy`,
      );
    },
    toBeFalsy() {
      checar(
        !real,
        `esperado ${descrever(real)} ser falsy`,
        `esperado ${descrever(real)} ser truthy`,
      );
    },
    toContain(item) {
      checar(
        contem(real, item),
        `esperado ${descrever(real)} conter ${descrever(item)}`,
        `esperado ${descrever(real)} NAO conter ${descrever(item)}`,
      );
    },
    toHaveProperty(caminho, ...resto) {
      const { existe, valor } = temPropriedade(real, caminho);
      const verificaValor = resto.length > 0;
      const ok = existe && (!verificaValor || deepEqual(valor, resto[0]));
      checar(
        ok,
        verificaValor
          ? `esperado ter propriedade "${caminho}" === ${descrever(resto[0])}`
          : `esperado ter propriedade "${caminho}"`,
        verificaValor
          ? `esperado NAO ter propriedade "${caminho}" === ${descrever(resto[0])}`
          : `esperado NAO ter propriedade "${caminho}"`,
      );
    },
    toBeGreaterThan(n) {
      const r = exigirNumero(real, "toBeGreaterThan");
      checar(
        r > n,
        `esperado ${r} > ${n}`,
        `esperado ${r} NAO > ${n}`,
      );
    },
    toBeLessThan(n) {
      const r = exigirNumero(real, "toBeLessThan");
      checar(
        r < n,
        `esperado ${r} < ${n}`,
        `esperado ${r} NAO < ${n}`,
      );
    },
    toBeGreaterThanOrEqual(n) {
      const r = exigirNumero(real, "toBeGreaterThanOrEqual");
      checar(
        r >= n,
        `esperado ${r} >= ${n}`,
        `esperado ${r} NAO >= ${n}`,
      );
    },
    toBeLessThanOrEqual(n) {
      const r = exigirNumero(real, "toBeLessThanOrEqual");
      checar(
        r <= n,
        `esperado ${r} <= ${n}`,
        `esperado ${r} NAO <= ${n}`,
      );
    },
  };
}

/** `expect(real)` completo, com `.not`. PURA. */
export function expect(real: unknown): Expectation {
  const positivo = criarExpect(real, false);
  return Object.assign(positivo, { not: criarExpect(real, true) });
}

/** Fabrica do `test(nome, fn)`: registra e roda cada teste. */
export function criarRegistroTestes(resultados: ResultadoTeste[]) {
  return function test(nome: unknown, fn: unknown): void {
    const nomeStr = nome === undefined || nome === null ? "" : String(nome);
    if (typeof fn !== "function") {
      resultados.push({
        nome: nomeStr,
        passou: false,
        erro: "test() requer uma funcao como segundo argumento",
      });
      return;
    }
    try {
      (fn as () => void)();
      resultados.push({ nome: nomeStr, passou: true });
    } catch (e) {
      resultados.push({ nome: nomeStr, passou: false, erro: mensagemErro(e) });
    }
  };
}

/** Console capturado para o runtime de testes (reusa o formatador do scripting). */
function criarConsoleCaptura(logs: string[]): Record<string, (...a: unknown[]) => void> {
  const push = (prefixo: string) => (...args: unknown[]) => {
    const linha = formatarLinha(args);
    logs.push(prefixo ? `${prefixo}${linha}` : linha);
  };
  return {
    log: push(""),
    info: push(""),
    debug: push(""),
    warn: push("[warn] "),
    error: push("[error] "),
  };
}

/**
 * Executa o `codigo` de testes do usuario injetando `test`, `expect`, `res`,
 * `ruan` e o `console` capturado. Devolve um resultado por `test(...)`. NUNCA
 * lanca: um erro de sintaxe ou um throw fora de `test()` vira um pseudo-teste
 * falho chamado "(erro)". LOGICA PURA (depende so dos argumentos).
 *
 * Codigo vazio/em-branco => sem resultados, sem erro.
 */
export function rodarTestes(
  codigo: string,
  res: unknown,
  ruan?: RuanApi,
): ResultadoTestes {
  const resultados: ResultadoTeste[] = [];
  const logs: string[] = [];
  if (typeof codigo !== "string" || codigo.trim() === "") {
    return { resultados, logs };
  }

  const test = criarRegistroTestes(resultados);
  const fakeConsole = criarConsoleCaptura(logs);
  const ruanSeguro: RuanApi = ruan ?? {
    getVar: () => undefined,
    setVar: () => {},
    getEnvVar: () => undefined,
    setEnvVar: () => {},
  };

  const nomesParams = [
    "test",
    "expect",
    "res",
    "ruan",
    "console",
    ...NOMES_BLOQUEADOS,
  ];

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...nomesParams, `"use strict";\n${codigo}`);
    const argsBloqueados = NOMES_BLOQUEADOS.map(() => undefined);
    fn(test, expect, res, ruanSeguro, fakeConsole, ...argsBloqueados);
  } catch (e) {
    // Erro fora de um test() (ex: sintaxe, throw no topo). Vira um teste falho
    // sintetico para a UI exibir, sem perder os testes que ja rodaram.
    resultados.push({ nome: "(erro)", passou: false, erro: mensagemErro(e) });
  }

  return { resultados, logs };
}

/** Conta passados/falhados de uma lista de resultados. PURA. */
export function resumir(resultados: ResultadoTeste[]): {
  total: number;
  passaram: number;
  falharam: number;
} {
  let passaram = 0;
  for (const r of resultados) if (r.passou) passaram++;
  return {
    total: resultados.length,
    passaram,
    falharam: resultados.length - passaram,
  };
}

/** Mensagem legivel de uma excecao (AssertionError mostra so a message). PURA. */
export function mensagemErro(e: unknown): string {
  if (e instanceof AssertionError) return e.message;
  if (e instanceof Error) {
    return e.name ? `${e.name}: ${e.message}` : e.message;
  }
  if (typeof e === "string") return e;
  return String(e);
}
