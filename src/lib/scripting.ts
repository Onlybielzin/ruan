// F12 — Execucao de scripts pre-request / post-response (LOGICA PURA, alvo de
// mutation). O usuario escreve JS que roda no FRONTEND (decisao M3): o pre-script
// pode mutar a request e setar variaveis; o post-script tem acesso ao `res`.
//
// A API exposta ao script chama-se `ruan` (NUNCA `bru`):
//   ruan.getVar(nome) / ruan.setVar(nome, valor)        -> runtime vars (sessao)
//   ruan.getEnvVar(nome) / ruan.setEnvVar(nome, valor)  -> environment ativo (disco)
//
// `console.log/info/warn/error` NAO escrevem no console real: sao capturados num
// buffer de strings devolvido em `logs` (a UI mostra no ScriptConsole).
//
// SEGURANCA (sandbox leve — o usuario roda os PROPRIOS scripts, mas ainda assim
// evitamos pegadinhas):
//   - execucao via `new Function(...)` com escopo controlado (sem acesso ao
//     escopo do modulo).
//   - `import`/`require`/`module`/`exports`/`process`/`global`/`globalThis` sao
//     mascarados como `undefined` no escopo do script (impede require/import e o
//     alcance trivial ao ambiente do app).
//   - erros do script sao capturados (try/catch) e viram `erro` (string) sem
//     derrubar o envio.
//   - os callbacks de var (get/set) sao injetados pelo store; a logica de
//     montagem do objeto `ruan` fica aqui (testavel sem o store).

/** Callbacks que o store injeta para dar acesso real as variaveis. */
export interface RuanCallbacks {
  /** Le uma runtime var (escopo runtime do VarScopes). */
  getVar: (nome: string) => string | undefined;
  /** Seta uma runtime var (persiste na sessao via envStore). */
  setVar: (nome: string, valor: string) => void;
  /** Le uma variavel do environment ativo. */
  getEnvVar: (nome: string) => string | undefined;
  /** Seta uma variavel do environment ativo (persiste no disco). */
  setEnvVar: (nome: string, valor: string) => void;
}

/** Objeto `ruan` exposto ao script (espelha os callbacks, normalizado). */
export interface RuanApi {
  getVar: (nome: string) => string | undefined;
  setVar: (nome: string, valor: string) => void;
  getEnvVar: (nome: string) => string | undefined;
  setEnvVar: (nome: string, valor: string) => void;
}

/** Resultado da execucao de um script. */
export interface ResultadoScript {
  /** Linhas capturadas de console.* (na ordem em que foram chamadas). */
  logs: string[];
  /** Mensagem de erro se o script lancou; ausente se rodou ok. */
  erro?: string;
}

/**
 * Monta o objeto `ruan` a partir dos callbacks do store. Normaliza os valores
 * setados para string (o usuario pode passar number/boolean/etc). LOGICA PURA.
 * Mantido separado para a montagem ser testavel sem o store real.
 */
export function montarRuan(cb: RuanCallbacks): RuanApi {
  return {
    getVar: (nome) => cb.getVar(String(nome)),
    setVar: (nome, valor) => cb.setVar(String(nome), normalizarValor(valor)),
    getEnvVar: (nome) => cb.getEnvVar(String(nome)),
    setEnvVar: (nome, valor) =>
      cb.setEnvVar(String(nome), normalizarValor(valor)),
  };
}

/** Converte um valor qualquer de var em string (vars sao sempre texto). */
export function normalizarValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor;
  return String(valor);
}

/** Serializa um argumento de console.* numa string legivel. LOGICA PURA. */
export function formatarArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg === undefined) return "undefined";
  if (arg === null) return "null";
  if (typeof arg === "bigint") return `${arg.toString()}n`;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/** Junta os argumentos de uma chamada de console numa unica linha. PURA. */
export function formatarLinha(args: unknown[]): string {
  return args.map(formatarArg).join(" ");
}

/**
 * Cria um `console` falso que empurra cada chamada para `logs`. Cada nivel
 * recebe um prefixo (warn/error) para a UI distinguir. LOGICA PURA.
 */
export function criarConsole(logs: string[]): Record<string, (...a: unknown[]) => void> {
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

// Identificadores do ambiente que mascaramos no escopo do script. Viram
// parametros nomeados da Function (recebendo `undefined`), entao qualquer uso
// dentro do script resolve para `undefined` em vez de alcancar o real.
//
// NAO inclua palavras reservadas (ex: `import`) — elas nao podem ser nome de
// parametro e fariam `new Function` lancar SyntaxError em TODO script. `import`
// (statement) ja e barrado pela sintaxe (so vale em modulo); `import()` dinamico
// e bloqueado pelo "use strict" + ausencia de escopo de modulo.
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

/**
 * Contexto de execucao injetado no script. `req` (e `res` no post) sao passados
 * por referencia: o pre-script MUTA `req` in-place (o wiring le de volta).
 */
export interface ContextoScript {
  ruan: RuanApi;
  /** Request mutavel (pre e post). Forma livre: o caller define o shape. */
  req: unknown;
  /** Resposta (so no post-script). */
  res?: unknown;
}

/**
 * Executa o `codigo` do usuario injetando `ruan`, `req`, `res` e o `console`
 * capturado. Retorna os logs e, se houve excecao, a mensagem em `erro`. Nunca
 * lanca (o envio nunca quebra por causa de um script do usuario). LOGICA PURA
 * o suficiente para teste: depende so do contexto/callbacks recebidos.
 *
 * Codigo vazio/em-branco e no-op (logs vazios, sem erro).
 */
export function runScript(
  codigo: string,
  contexto: ContextoScript,
): ResultadoScript {
  const logs: string[] = [];
  if (typeof codigo !== "string" || codigo.trim() === "") {
    return { logs };
  }

  const fakeConsole = criarConsole(logs);
  // Parametros nomeados da Function: o que o script enxerga. Os bloqueados
  // entram por ultimo recebendo `undefined`, sombreando o ambiente real.
  const nomesParams = [
    "ruan",
    "req",
    "res",
    "console",
    ...NOMES_BLOQUEADOS,
  ];

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...nomesParams, `"use strict";\n${codigo}`);
    const argsBloqueados = NOMES_BLOQUEADOS.map(() => undefined);
    fn(contexto.ruan, contexto.req, contexto.res, fakeConsole, ...argsBloqueados);
    return { logs };
  } catch (e) {
    return { logs, erro: mensagemErroScript(e) };
  }
}

/**
 * Insere/atualiza uma variavel num array por nome (upsert). Se ja existir uma
 * com o `nome`, atualiza o `value` da PRIMEIRA ocorrencia (preservando enabled/
 * secret/description); senao acrescenta uma nova (enabled, nao-secret) ao fim.
 * Retorna um NOVO array (nao muta a entrada). LOGICA PURA — usado pelo envStore
 * para `ruan.setEnvVar`.
 */
export function upsertVar<
  T extends { name: string; value: string; enabled: boolean; secret: boolean },
>(vars: T[], nome: string, valor: string): T[] {
  const idx = vars.findIndex((v) => v.name === nome);
  if (idx === -1) {
    const nova = { name: nome, value: valor, enabled: true, secret: false } as T;
    return [...vars, nova];
  }
  return vars.map((v, i) => (i === idx ? { ...v, value: valor } : v));
}

/** Extrai uma mensagem legivel de uma excecao de script. PURA. */
export function mensagemErroScript(e: unknown): string {
  if (e instanceof Error) {
    return e.name ? `${e.name}: ${e.message}` : e.message;
  }
  if (typeof e === "string") return e;
  return String(e);
}
