// Testes da logica pura de scripting pre/post (F12).
// Alvo de mutation: src/lib/scripting.ts

import { describe, it, expect, vi } from "vitest";
import {
  montarRuan,
  normalizarValor,
  formatarArg,
  formatarLinha,
  criarConsole,
  runScript,
  upsertVar,
  mensagemErroScript,
  type RuanCallbacks,
  type ContextoScript,
} from "./scripting";

// ---------------------------------------------------------------------------
// normalizarValor
// ---------------------------------------------------------------------------
describe("normalizarValor", () => {
  it("null vira string vazia", () => {
    expect(normalizarValor(null)).toBe("");
  });
  it("undefined vira string vazia", () => {
    expect(normalizarValor(undefined)).toBe("");
  });
  it("string passa inalterada (sem coercao)", () => {
    expect(normalizarValor("abc")).toBe("abc");
    expect(normalizarValor("")).toBe("");
  });
  it("number vira sua representacao textual", () => {
    expect(normalizarValor(42)).toBe("42");
    expect(normalizarValor(0)).toBe("0");
    expect(normalizarValor(-1.5)).toBe("-1.5");
  });
  it("boolean vira texto", () => {
    expect(normalizarValor(true)).toBe("true");
    expect(normalizarValor(false)).toBe("false");
  });
  it("nao confunde 0/false com null (nao retorna vazio)", () => {
    expect(normalizarValor(0)).not.toBe("");
    expect(normalizarValor(false)).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatarArg
// ---------------------------------------------------------------------------
describe("formatarArg", () => {
  it("string passa inalterada (sem aspas)", () => {
    expect(formatarArg("oi")).toBe("oi");
  });
  it("undefined vira 'undefined'", () => {
    expect(formatarArg(undefined)).toBe("undefined");
  });
  it("null vira 'null'", () => {
    expect(formatarArg(null)).toBe("null");
  });
  it("bigint ganha sufixo n", () => {
    expect(formatarArg(10n)).toBe("10n");
  });
  it("Error vira 'Name: message'", () => {
    expect(formatarArg(new TypeError("boom"))).toBe("TypeError: boom");
  });
  it("objeto vira JSON", () => {
    expect(formatarArg({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
  });
  it("array vira JSON", () => {
    expect(formatarArg([1, 2, 3])).toBe("[1,2,3]");
  });
  it("objeto circular nao lanca (fallback String)", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    // nao deve lancar; String(obj) e o fallback
    expect(() => formatarArg(o)).not.toThrow();
    expect(formatarArg(o)).toBe("[object Object]");
  });
  it("number vira texto", () => {
    expect(formatarArg(7)).toBe("7");
  });
  it("boolean vira texto", () => {
    expect(formatarArg(true)).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// formatarLinha
// ---------------------------------------------------------------------------
describe("formatarLinha", () => {
  it("junta args com espaco simples", () => {
    expect(formatarLinha(["a", 1, true])).toBe("a 1 true");
  });
  it("array vazio vira string vazia", () => {
    expect(formatarLinha([])).toBe("");
  });
  it("um unico arg nao adiciona espaco", () => {
    expect(formatarLinha(["solo"])).toBe("solo");
  });
  it("preserva ordem e formata cada arg", () => {
    expect(formatarLinha([null, undefined])).toBe("null undefined");
  });
});

// ---------------------------------------------------------------------------
// criarConsole
// ---------------------------------------------------------------------------
describe("criarConsole", () => {
  it("log/info/debug empurram sem prefixo", () => {
    const logs: string[] = [];
    const c = criarConsole(logs);
    c.log("um");
    c.info("dois");
    c.debug("tres");
    expect(logs).toEqual(["um", "dois", "tres"]);
  });
  it("warn tem prefixo [warn]", () => {
    const logs: string[] = [];
    criarConsole(logs).warn("cuidado");
    expect(logs).toEqual(["[warn] cuidado"]);
  });
  it("error tem prefixo [error]", () => {
    const logs: string[] = [];
    criarConsole(logs).error("ruim");
    expect(logs).toEqual(["[error] ruim"]);
  });
  it("mantem ordem entre niveis diferentes", () => {
    const logs: string[] = [];
    const c = criarConsole(logs);
    c.log("a");
    c.warn("b");
    c.error("c");
    expect(logs).toEqual(["a", "[warn] b", "[error] c"]);
  });
  it("multiplos args sao formatados numa linha", () => {
    const logs: string[] = [];
    criarConsole(logs).log("x", 1, { y: 2 });
    expect(logs).toEqual(['x 1 {"y":2}']);
  });
});

// ---------------------------------------------------------------------------
// montarRuan
// ---------------------------------------------------------------------------
describe("montarRuan", () => {
  function cbs() {
    const store: Record<string, string> = {};
    const env: Record<string, string> = {};
    const cb: RuanCallbacks = {
      getVar: vi.fn((n: string) => store[n]),
      setVar: vi.fn((n: string, v: string) => {
        store[n] = v;
      }),
      getEnvVar: vi.fn((n: string) => env[n]),
      setEnvVar: vi.fn((n: string, v: string) => {
        env[n] = v;
      }),
    };
    return { cb, store, env };
  }

  it("getVar delega ao callback", () => {
    const { cb, store } = cbs();
    store.token = "abc";
    expect(montarRuan(cb).getVar("token")).toBe("abc");
    expect(cb.getVar).toHaveBeenCalledWith("token");
  });

  it("setVar normaliza valor para string antes de delegar", () => {
    const { cb, store } = cbs();
    montarRuan(cb).setVar("n", 5 as unknown as string);
    expect(store.n).toBe("5");
    expect(cb.setVar).toHaveBeenCalledWith("n", "5");
  });

  it("getEnvVar delega ao callback de env", () => {
    const { cb, env } = cbs();
    env.base = "https://x";
    expect(montarRuan(cb).getEnvVar("base")).toBe("https://x");
    expect(cb.getEnvVar).toHaveBeenCalledWith("base");
  });

  it("setEnvVar normaliza valor (boolean -> texto)", () => {
    const { cb, env } = cbs();
    montarRuan(cb).setEnvVar("flag", true as unknown as string);
    expect(env.flag).toBe("true");
    expect(cb.setEnvVar).toHaveBeenCalledWith("flag", "true");
  });

  it("setVar de null vira string vazia (nao 'null')", () => {
    const { cb, store } = cbs();
    montarRuan(cb).setVar("z", null as unknown as string);
    expect(store.z).toBe("");
  });

  it("nome e coagido a string", () => {
    const { cb } = cbs();
    montarRuan(cb).getVar(123 as unknown as string);
    expect(cb.getVar).toHaveBeenCalledWith("123");
  });

  it("getVar usa o getter de var, nao o de env (sem trocar canais)", () => {
    const { cb, store, env } = cbs();
    store.k = "runtime";
    env.k = "environment";
    expect(montarRuan(cb).getVar("k")).toBe("runtime");
    expect(montarRuan(cb).getEnvVar("k")).toBe("environment");
  });
});

// ---------------------------------------------------------------------------
// runScript
// ---------------------------------------------------------------------------
describe("runScript", () => {
  function ctx(over: Partial<ContextoScript> = {}): ContextoScript {
    const calls: Array<[string, string]> = [];
    const ruan = {
      getVar: (n: string) => (n === "existe" ? "valor" : undefined),
      setVar: (n: string, v: string) => {
        calls.push([n, v]);
      },
      getEnvVar: (n: string) => (n === "envk" ? "envv" : undefined),
      setEnvVar: (n: string, v: string) => {
        calls.push([`env:${n}`, v]);
      },
    };
    // expoe calls via closure no objeto retornado
    return Object.assign(
      { ruan, req: {}, res: undefined, ...over },
      { __calls: calls } as unknown as ContextoScript,
    );
  }

  it("codigo vazio e no-op (logs vazios, sem erro)", () => {
    const r = runScript("", ctx());
    expect(r.logs).toEqual([]);
    expect(r.erro).toBeUndefined();
  });

  it("codigo so com espacos e no-op", () => {
    const r = runScript("   \n\t ", ctx());
    expect(r.logs).toEqual([]);
    expect(r.erro).toBeUndefined();
  });

  it("codigo nao-string e no-op seguro", () => {
    const r = runScript(undefined as unknown as string, ctx());
    expect(r.logs).toEqual([]);
    expect(r.erro).toBeUndefined();
  });

  it("captura console.log no buffer de logs", () => {
    const r = runScript("console.log('oi', 1)", ctx());
    expect(r.logs).toEqual(["oi 1"]);
    expect(r.erro).toBeUndefined();
  });

  it("captura warn/error com prefixo", () => {
    const r = runScript("console.warn('w'); console.error('e')", ctx());
    expect(r.logs).toEqual(["[warn] w", "[error] e"]);
  });

  it("erro de sintaxe vira erro (string), sem lancar", () => {
    const r = runScript("this is not js {{{", ctx());
    expect(r.erro).toBeTypeOf("string");
    expect(r.erro).toBeTruthy();
    expect(r.logs).toEqual([]);
  });

  it("erro de runtime vira erro e preserva logs ja emitidos", () => {
    const r = runScript("console.log('antes'); throw new Error('boom')", ctx());
    expect(r.logs).toEqual(["antes"]);
    expect(r.erro).toBe("Error: boom");
  });

  it("throw de string e capturado", () => {
    const r = runScript("throw 'na';", ctx());
    expect(r.erro).toBe("na");
  });

  it("muta req in-place (pre-script)", () => {
    const c = ctx({ req: { url: "a", headers: {} } });
    const r = runScript(
      "req.url = 'b'; req.headers['X'] = '1';",
      c,
    );
    expect(r.erro).toBeUndefined();
    expect((c.req as Record<string, unknown>).url).toBe("b");
    expect(
      ((c.req as Record<string, Record<string, string>>).headers).X,
    ).toBe("1");
  });

  it("ruan.getVar funciona dentro do script", () => {
    const c = ctx({ req: { v: "" } });
    runScript("req.v = ruan.getVar('existe')", c);
    expect((c.req as Record<string, unknown>).v).toBe("valor");
  });

  it("ruan.getVar de var inexistente retorna undefined", () => {
    const c = ctx({ req: { v: "nope" } });
    runScript("req.v = ruan.getVar('faltando')", c);
    expect((c.req as Record<string, unknown>).v).toBeUndefined();
  });

  it("ruan.setVar chega no callback", () => {
    const c = ctx();
    runScript("ruan.setVar('k', 'V')", c);
    expect((c as unknown as { __calls: Array<[string, string]> }).__calls).toContainEqual(["k", "V"]);
  });

  it("ruan.setEnvVar chega no callback de env", () => {
    const c = ctx();
    runScript("ruan.setEnvVar('ek', 'EV')", c);
    expect((c as unknown as { __calls: Array<[string, string]> }).__calls).toContainEqual(["env:ek", "EV"]);
  });

  it("post-script enxerga res", () => {
    const c = ctx({ res: { status: 200, body: "ok" } });
    const r = runScript("console.log(res.status)", c);
    expect(r.logs).toEqual(["200"]);
  });

  it("identificadores bloqueados resolvem para undefined (guarda-corpo)", () => {
    // require/process/fetch sao mascarados como parametros undefined
    const r = runScript(
      "console.log(typeof require, typeof process, typeof fetch)",
      ctx(),
    );
    expect(r.logs).toEqual(["undefined undefined undefined"]);
    expect(r.erro).toBeUndefined();
  });

  it("window/globalThis mascarados como undefined", () => {
    const r = runScript("console.log(typeof window, typeof globalThis)", ctx());
    expect(r.logs).toEqual(["undefined undefined"]);
  });

  it("usa 'use strict' (atribuicao a undeclared lanca, vira erro)", () => {
    const r = runScript("naoDeclarada = 1", ctx());
    expect(r.erro).toBeTypeOf("string");
    expect(r.erro).toBeTruthy();
  });

  it("res undefined no pre-script nao quebra leitura opcional", () => {
    const r = runScript("console.log(typeof res)", ctx({ res: undefined }));
    expect(r.logs).toEqual(["undefined"]);
    expect(r.erro).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// upsertVar
// ---------------------------------------------------------------------------
type V = { name: string; value: string; enabled: boolean; secret: boolean };

describe("upsertVar", () => {
  const base: V[] = [
    { name: "a", value: "1", enabled: true, secret: false },
    { name: "b", value: "2", enabled: false, secret: true },
  ];

  it("atualiza valor de var existente preservando enabled/secret", () => {
    const out = upsertVar(base, "b", "novo");
    expect(out[1]).toEqual({ name: "b", value: "novo", enabled: false, secret: true });
  });

  it("nao muta o array de entrada (retorna novo)", () => {
    const out = upsertVar(base, "b", "novo");
    expect(out).not.toBe(base);
    expect(base[1].value).toBe("2");
  });

  it("acrescenta nova var (enabled, nao-secret) ao fim", () => {
    const out = upsertVar(base, "c", "3");
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ name: "c", value: "3", enabled: true, secret: false });
  });

  it("preserva as demais vars inalteradas no update", () => {
    const out = upsertVar(base, "b", "x");
    expect(out[0]).toEqual(base[0]);
  });

  it("atualiza somente a PRIMEIRA ocorrencia em caso de nome duplicado", () => {
    const dup: V[] = [
      { name: "d", value: "old1", enabled: true, secret: false },
      { name: "d", value: "old2", enabled: true, secret: false },
    ];
    const out = upsertVar(dup, "d", "new");
    expect(out[0].value).toBe("new");
    expect(out[1].value).toBe("old2");
  });

  it("upsert em array vazio cria a primeira var", () => {
    const out = upsertVar([] as V[], "x", "y");
    expect(out).toEqual([{ name: "x", value: "y", enabled: true, secret: false }]);
  });

  it("nao altera elementos por referencia exceto o atualizado", () => {
    const out = upsertVar(base, "a", "z");
    expect(out[1]).toBe(base[1]); // intocado preserva referencia
    expect(out[0]).not.toBe(base[0]); // atualizado e novo objeto
  });
});

// ---------------------------------------------------------------------------
// mensagemErroScript
// ---------------------------------------------------------------------------
describe("mensagemErroScript", () => {
  it("Error com name vira 'Name: message'", () => {
    expect(mensagemErroScript(new TypeError("x"))).toBe("TypeError: x");
  });
  it("string passa inalterada", () => {
    expect(mensagemErroScript("falha")).toBe("falha");
  });
  it("numero vira texto", () => {
    expect(mensagemErroScript(42)).toBe("42");
  });
  it("null vira 'null'", () => {
    expect(mensagemErroScript(null)).toBe("null");
  });
  it("Error sem name usa so a message", () => {
    const e = new Error("msg");
    // forca name vazio
    Object.defineProperty(e, "name", { value: "" });
    expect(mensagemErroScript(e)).toBe("msg");
  });
  it("objeto generico vira String(obj)", () => {
    expect(mensagemErroScript({ toString: () => "OBJ" })).toBe("OBJ");
  });
});
