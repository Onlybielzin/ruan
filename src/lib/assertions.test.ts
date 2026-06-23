// Testes da logica pura do runtime de testes/assertions (F13).
// Alvo de mutation: src/lib/assertions.ts
//
// NOTA: o modulo exporta um `expect` proprio (matchers do usuario). Para nao
// colidir com o `expect` do Vitest, importamos o do modulo como `expectRuan`.

import { describe, it, expect } from "vitest";
import {
  AssertionError,
  descrever,
  deepEqual,
  contem,
  temPropriedade,
  criarExpect,
  expect as expectRuan,
  criarRegistroTestes,
  rodarTestes,
  resumir,
  mensagemErro,
  type ResultadoTeste,
  type RuanApi,
} from "./assertions";

// ---------------------------------------------------------------------------
// descrever
// ---------------------------------------------------------------------------
describe("descrever", () => {
  it("string vem com aspas (JSON)", () => {
    expect(descrever("abc")).toBe('"abc"');
    expect(descrever("")).toBe('""');
  });
  it("undefined e null", () => {
    expect(descrever(undefined)).toBe("undefined");
    expect(descrever(null)).toBe("null");
  });
  it("bigint ganha sufixo n", () => {
    expect(descrever(10n)).toBe("10n");
  });
  it("function vira [Function]", () => {
    expect(descrever(() => {})).toBe("[Function]");
  });
  it("objeto via JSON.stringify", () => {
    expect(descrever({ a: 1 })).toBe('{"a":1}');
    expect(descrever([1, 2])).toBe("[1,2]");
  });
  it("objeto circular cai no catch -> String()", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    // nao lanca; retorna algo (String do objeto)
    expect(typeof descrever(o)).toBe("string");
    expect(descrever(o)).toBe("[object Object]");
  });
  it("numero e boolean via String", () => {
    expect(descrever(42)).toBe("42");
    expect(descrever(true)).toBe("true");
    expect(descrever(false)).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// deepEqual
// ---------------------------------------------------------------------------
describe("deepEqual", () => {
  it("primitivos iguais por Object.is", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });
  it("NaN === NaN (Object.is)", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
  it("+0 e -0 sao distintos (Object.is)", () => {
    expect(deepEqual(0, -0)).toBe(false);
  });
  it("primitivos diferentes", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });
  it("um objeto e outro primitivo => false", () => {
    expect(deepEqual({ a: 1 }, 1)).toBe(false);
    expect(deepEqual(1, { a: 1 })).toBe(false);
  });
  it("null vs objeto => false (nao crasha)", () => {
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({}, null)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
  });
  it("array vs objeto (mesmo conteudo) => false", () => {
    expect(deepEqual([], {})).toBe(false);
  });
  it("arrays de tamanhos diferentes", () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });
  it("arrays iguais e diferentes por elemento", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [1, 9, 3])).toBe(false);
  });
  it("arrays aninhados", () => {
    expect(deepEqual([[1], [2]], [[1], [2]])).toBe(true);
    expect(deepEqual([[1], [2]], [[1], [3]])).toBe(false);
  });
  it("objetos planos iguais", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true); // ordem nao importa
  });
  it("objetos com numero de chaves diferentes", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
  it("mesmas qtd de chaves mas nomes diferentes", () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });
  it("objetos aninhados", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contem
// ---------------------------------------------------------------------------
describe("contem", () => {
  it("string substring", () => {
    expect(contem("hello world", "world")).toBe(true);
    expect(contem("hello", "xyz")).toBe(false);
  });
  it("string coage item para string", () => {
    expect(contem("abc123", 123)).toBe(true);
  });
  it("array compara por deepEqual", () => {
    expect(contem([1, 2, 3], 2)).toBe(true);
    expect(contem([1, 2, 3], 9)).toBe(false);
    expect(contem([{ a: 1 }], { a: 1 })).toBe(true);
  });
  it("nao-string/nao-array => false", () => {
    expect(contem(42, 4)).toBe(false);
    expect(contem(null, 1)).toBe(false);
    expect(contem({ a: 1 }, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// temPropriedade
// ---------------------------------------------------------------------------
describe("temPropriedade", () => {
  it("propriedade simples existe", () => {
    expect(temPropriedade({ a: 1 }, "a")).toEqual({ existe: true, valor: 1 });
  });
  it("propriedade ausente", () => {
    expect(temPropriedade({ a: 1 }, "b")).toEqual({
      existe: false,
      valor: undefined,
    });
  });
  it("caminho aninhado a.b.c", () => {
    expect(temPropriedade({ a: { b: { c: 5 } } }, "a.b.c")).toEqual({
      existe: true,
      valor: 5,
    });
  });
  it("caminho aninhado quebra no meio", () => {
    expect(temPropriedade({ a: { b: 1 } }, "a.x.c")).toEqual({
      existe: false,
      valor: undefined,
    });
  });
  it("alvo null/undefined => nao existe", () => {
    expect(temPropriedade(null, "a")).toEqual({ existe: false, valor: undefined });
    expect(temPropriedade(undefined, "a")).toEqual({
      existe: false,
      valor: undefined,
    });
  });
  it("indice de array", () => {
    expect(temPropriedade([10, 20], "1")).toEqual({ existe: true, valor: 20 });
    expect(temPropriedade({ lista: [9] }, "lista.0")).toEqual({
      existe: true,
      valor: 9,
    });
  });
  it("nao casa propriedade herdada do prototipo (hasOwnProperty)", () => {
    expect(temPropriedade({ a: 1 }, "toString").existe).toBe(false);
    expect(temPropriedade({ a: 1 }, "constructor").existe).toBe(false);
    expect(temPropriedade({ a: 1 }, "__proto__").existe).toBe(false);
  });
  it("valor undefined explicito ainda conta como existente", () => {
    expect(temPropriedade({ a: undefined }, "a")).toEqual({
      existe: true,
      valor: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// criarExpect — matchers positivos
// ---------------------------------------------------------------------------
describe("criarExpect (positivo)", () => {
  it("toBe passa quando Object.is bate, lanca AssertionError quando nao", () => {
    expect(() => criarExpect(1).toBe(1)).not.toThrow();
    expect(() => criarExpect(1).toBe(2)).toThrow(AssertionError);
  });
  it("toBe usa Object.is: NaN===NaN, +0!==-0", () => {
    expect(() => criarExpect(NaN).toBe(NaN)).not.toThrow();
    expect(() => criarExpect(0).toBe(-0)).toThrow(AssertionError);
  });
  it("toEqual usa deepEqual", () => {
    expect(() => criarExpect({ a: 1 }).toEqual({ a: 1 })).not.toThrow();
    expect(() => criarExpect({ a: 1 }).toEqual({ a: 2 })).toThrow(AssertionError);
  });
  it("toBeTruthy", () => {
    expect(() => criarExpect(1).toBeTruthy()).not.toThrow();
    expect(() => criarExpect("x").toBeTruthy()).not.toThrow();
    expect(() => criarExpect(0).toBeTruthy()).toThrow(AssertionError);
    expect(() => criarExpect("").toBeTruthy()).toThrow(AssertionError);
  });
  it("toBeFalsy", () => {
    expect(() => criarExpect(0).toBeFalsy()).not.toThrow();
    expect(() => criarExpect("").toBeFalsy()).not.toThrow();
    expect(() => criarExpect(1).toBeFalsy()).toThrow(AssertionError);
  });
  it("toContain", () => {
    expect(() => criarExpect("abc").toContain("b")).not.toThrow();
    expect(() => criarExpect([1, 2]).toContain(2)).not.toThrow();
    expect(() => criarExpect("abc").toContain("z")).toThrow(AssertionError);
  });
  it("toHaveProperty sem valor", () => {
    expect(() => criarExpect({ a: 1 }).toHaveProperty("a")).not.toThrow();
    expect(() => criarExpect({ a: 1 }).toHaveProperty("b")).toThrow(
      AssertionError,
    );
  });
  it("toHaveProperty com valor", () => {
    expect(() => criarExpect({ a: 1 }).toHaveProperty("a", 1)).not.toThrow();
    expect(() => criarExpect({ a: 1 }).toHaveProperty("a", 2)).toThrow(
      AssertionError,
    );
  });
  it("toHaveProperty com valor undefined explicito (resto.length>0)", () => {
    // valor presente mas !== undefined => falha
    expect(() => criarExpect({ a: 1 }).toHaveProperty("a", undefined)).toThrow(
      AssertionError,
    );
    // propriedade igual a undefined => passa quando comparada a undefined
    expect(() =>
      criarExpect({ a: undefined }).toHaveProperty("a", undefined),
    ).not.toThrow();
  });
  it("toBeGreaterThan", () => {
    expect(() => criarExpect(5).toBeGreaterThan(3)).not.toThrow();
    expect(() => criarExpect(3).toBeGreaterThan(3)).toThrow(AssertionError);
    expect(() => criarExpect(2).toBeGreaterThan(3)).toThrow(AssertionError);
  });
  it("toBeLessThan", () => {
    expect(() => criarExpect(2).toBeLessThan(3)).not.toThrow();
    expect(() => criarExpect(3).toBeLessThan(3)).toThrow(AssertionError);
  });
  it("toBeGreaterThanOrEqual", () => {
    expect(() => criarExpect(3).toBeGreaterThanOrEqual(3)).not.toThrow();
    expect(() => criarExpect(4).toBeGreaterThanOrEqual(3)).not.toThrow();
    expect(() => criarExpect(2).toBeGreaterThanOrEqual(3)).toThrow(
      AssertionError,
    );
  });
  it("toBeLessThanOrEqual", () => {
    expect(() => criarExpect(3).toBeLessThanOrEqual(3)).not.toThrow();
    expect(() => criarExpect(2).toBeLessThanOrEqual(3)).not.toThrow();
    expect(() => criarExpect(4).toBeLessThanOrEqual(3)).toThrow(AssertionError);
  });
  it("matchers numericos exigem numero no real", () => {
    expect(() => criarExpect("5").toBeGreaterThan(3)).toThrow(AssertionError);
    expect(() => criarExpect(null).toBeLessThan(3)).toThrow(AssertionError);
    expect(() => criarExpect("5").toBeGreaterThanOrEqual(3)).toThrow(
      AssertionError,
    );
    expect(() => criarExpect("5").toBeLessThanOrEqual(3)).toThrow(
      AssertionError,
    );
  });
  it("mensagem de erro de toBe descreve os dois lados", () => {
    try {
      criarExpect(1).toBe(2);
      throw new Error("deveria ter lancado");
    } catch (e) {
      expect(e).toBeInstanceOf(AssertionError);
      expect((e as Error).message).toContain("1");
      expect((e as Error).message).toContain("2");
      expect((e as Error).message).toContain("===");
    }
  });
});

// ---------------------------------------------------------------------------
// criarExpect — negado (.not)
// ---------------------------------------------------------------------------
describe("criarExpect (negado)", () => {
  it("not.toBe inverte", () => {
    expect(() => criarExpect(1, true).toBe(2)).not.toThrow();
    expect(() => criarExpect(1, true).toBe(1)).toThrow(AssertionError);
  });
  it("not.toEqual inverte", () => {
    expect(() => criarExpect({ a: 1 }, true).toEqual({ a: 2 })).not.toThrow();
    expect(() => criarExpect({ a: 1 }, true).toEqual({ a: 1 })).toThrow(
      AssertionError,
    );
  });
  it("not.toBeTruthy / not.toBeFalsy", () => {
    expect(() => criarExpect(0, true).toBeTruthy()).not.toThrow();
    expect(() => criarExpect(1, true).toBeTruthy()).toThrow(AssertionError);
    expect(() => criarExpect(1, true).toBeFalsy()).not.toThrow();
    expect(() => criarExpect(0, true).toBeFalsy()).toThrow(AssertionError);
  });
  it("not.toContain inverte", () => {
    expect(() => criarExpect("abc", true).toContain("z")).not.toThrow();
    expect(() => criarExpect("abc", true).toContain("a")).toThrow(
      AssertionError,
    );
  });
  it("not.toHaveProperty inverte", () => {
    expect(() => criarExpect({ a: 1 }, true).toHaveProperty("b")).not.toThrow();
    expect(() => criarExpect({ a: 1 }, true).toHaveProperty("a")).toThrow(
      AssertionError,
    );
  });
  it("not nos comparadores numericos", () => {
    expect(() => criarExpect(2, true).toBeGreaterThan(3)).not.toThrow();
    expect(() => criarExpect(5, true).toBeGreaterThan(3)).toThrow(
      AssertionError,
    );
  });
  it("mensagem negada usa a variante msgNeg", () => {
    try {
      criarExpect(1, true).toBe(1);
      throw new Error("deveria ter lancado");
    } catch (e) {
      expect((e as Error).message).toContain("!==");
    }
  });
});

// ---------------------------------------------------------------------------
// expect (com .not)
// ---------------------------------------------------------------------------
describe("expect (publico, com .not)", () => {
  it("expoe matchers positivos diretamente", () => {
    expect(() => expectRuan(1).toBe(1)).not.toThrow();
    expect(() => expectRuan(1).toBe(2)).toThrow(AssertionError);
  });
  it("expoe .not com a logica invertida", () => {
    expect(() => expectRuan(1).not.toBe(2)).not.toThrow();
    expect(() => expectRuan(1).not.toBe(1)).toThrow(AssertionError);
  });
  it(".not nao afeta os matchers positivos do mesmo objeto", () => {
    const ex = expectRuan(5);
    expect(() => ex.toBeGreaterThan(3)).not.toThrow();
    expect(() => ex.not.toBeGreaterThan(3)).toThrow(AssertionError);
  });
});

// ---------------------------------------------------------------------------
// criarRegistroTestes / test()
// ---------------------------------------------------------------------------
describe("criarRegistroTestes", () => {
  it("registra teste que passa", () => {
    const resultados: ResultadoTeste[] = [];
    const test = criarRegistroTestes(resultados);
    test("ok", () => {});
    expect(resultados).toEqual([{ nome: "ok", passou: true }]);
  });
  it("registra teste que falha capturando a mensagem", () => {
    const resultados: ResultadoTeste[] = [];
    const test = criarRegistroTestes(resultados);
    test("falha", () => {
      throw new AssertionError("boom");
    });
    expect(resultados).toEqual([
      { nome: "falha", passou: false, erro: "boom" },
    ]);
  });
  it("fn ausente / nao-funcao => resultado falho", () => {
    const resultados: ResultadoTeste[] = [];
    const test = criarRegistroTestes(resultados);
    test("sem fn", undefined);
    expect(resultados[0].passou).toBe(false);
    expect(resultados[0].erro).toContain("funcao");
  });
  it("nome null/undefined vira string vazia", () => {
    const resultados: ResultadoTeste[] = [];
    const test = criarRegistroTestes(resultados);
    test(undefined, () => {});
    test(null, () => {});
    expect(resultados[0].nome).toBe("");
    expect(resultados[1].nome).toBe("");
  });
  it("nome nao-string vira String(nome)", () => {
    const resultados: ResultadoTeste[] = [];
    const test = criarRegistroTestes(resultados);
    test(42, () => {});
    expect(resultados[0].nome).toBe("42");
  });
  it("preserva ordem e acumula multiplos", () => {
    const resultados: ResultadoTeste[] = [];
    const test = criarRegistroTestes(resultados);
    test("a", () => {});
    test("b", () => {
      throw new Error("x");
    });
    test("c", () => {});
    expect(resultados.map((r) => r.nome)).toEqual(["a", "b", "c"]);
    expect(resultados.map((r) => r.passou)).toEqual([true, false, true]);
  });
});

// ---------------------------------------------------------------------------
// rodarTestes — integracao do runtime
// ---------------------------------------------------------------------------
describe("rodarTestes", () => {
  it("codigo vazio => sem resultados nem logs, sem lancar", () => {
    expect(rodarTestes("", null)).toEqual({ resultados: [], logs: [] });
    expect(rodarTestes("   \n  ", null)).toEqual({ resultados: [], logs: [] });
  });
  it("codigo nao-string => sem resultados", () => {
    expect(rodarTestes(undefined as unknown as string, null)).toEqual({
      resultados: [],
      logs: [],
    });
  });
  it("teste que passa com expect e res", () => {
    const { resultados } = rodarTestes(
      `test('status', () => { expect(res.status).toBe(200); });`,
      { status: 200 },
    );
    expect(resultados).toEqual([{ nome: "status", passou: true }]);
  });
  it("teste que falha registra erro limpo (sem stack)", () => {
    const { resultados } = rodarTestes(
      `test('status', () => { expect(res.status).toBe(200); });`,
      { status: 404 },
    );
    expect(resultados[0].nome).toBe("status");
    expect(resultados[0].passou).toBe(false);
    expect(resultados[0].erro).toContain("404");
    expect(resultados[0].erro).not.toContain("at ");
  });
  it("multiplos testes na ordem", () => {
    const { resultados } = rodarTestes(
      `
        test('a', () => { expect(1).toBe(1); });
        test('b', () => { expect(1).toBe(2); });
      `,
      null,
    );
    expect(resultados.map((r) => [r.nome, r.passou])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
  it("erro de sintaxe vira pseudo-teste (erro) falho, NUNCA lanca", () => {
    const { resultados } = rodarTestes("test('x' => {", null);
    expect(resultados).toHaveLength(1);
    expect(resultados[0].nome).toBe("(erro)");
    expect(resultados[0].passou).toBe(false);
    expect(typeof resultados[0].erro).toBe("string");
  });
  it("throw no topo (fora de test) vira pseudo-teste (erro)", () => {
    const { resultados } = rodarTestes(
      `test('a', () => {}); throw new Error('topo');`,
      null,
    );
    // o test 'a' rodou ANTES do throw -> preservado
    expect(resultados[0]).toEqual({ nome: "a", passou: true });
    const erro = resultados.find((r) => r.nome === "(erro)");
    expect(erro?.passou).toBe(false);
    expect(erro?.erro).toContain("topo");
  });
  it("captura console.* em logs (com prefixos)", () => {
    const { logs } = rodarTestes(
      `
        console.log('hi', 1);
        console.warn('w');
        console.error('e');
      `,
      null,
    );
    expect(logs).toEqual(["hi 1", "[warn] w", "[error] e"]);
  });
  it("expoe ruan; set* sao no-op quando ruan ausente (nao lanca)", () => {
    const { resultados } = rodarTestes(
      `
        test('ruan', () => {
          ruan.setVar('k', 'v');
          expect(ruan.getVar('k')).toBe(undefined);
        });
      `,
      null,
    );
    expect(resultados[0].passou).toBe(true);
  });
  it("usa o ruan fornecido", () => {
    const store: Record<string, string> = {};
    const ruan: RuanApi = {
      getVar: (n) => store[n],
      setVar: (n, v) => {
        store[n] = v;
      },
      getEnvVar: (n) => store[n],
      setEnvVar: (n, v) => {
        store[n] = v;
      },
    };
    const { resultados } = rodarTestes(
      `
        test('lê var', () => {
          ruan.setVar('token', 'abc');
          expect(ruan.getVar('token')).toBe('abc');
        });
      `,
      null,
      ruan,
    );
    expect(resultados[0].passou).toBe(true);
    expect(store.token).toBe("abc");
  });
  it("nomes do ambiente mascarados sao undefined no escopo", () => {
    const { resultados } = rodarTestes(
      `
        test('fetch mascarado', () => { expect(fetch).toBe(undefined); });
        test('window mascarado', () => { expect(window).toBe(undefined); });
        test('process mascarado', () => { expect(process).toBe(undefined); });
      `,
      null,
    );
    expect(resultados.every((r) => r.passou)).toBe(true);
  });
  it("not funciona dentro do codigo do usuario", () => {
    const { resultados } = rodarTestes(
      `test('not', () => { expect(res.status).not.toBe(500); });`,
      { status: 200 },
    );
    expect(resultados[0].passou).toBe(true);
  });
  it("toHaveProperty aninhado dentro do codigo", () => {
    const { resultados } = rodarTestes(
      `test('prop', () => { expect(res).toHaveProperty('body.id', 7); });`,
      { body: { id: 7 } },
    );
    expect(resultados[0].passou).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resumir
// ---------------------------------------------------------------------------
describe("resumir", () => {
  it("lista vazia", () => {
    expect(resumir([])).toEqual({ total: 0, passaram: 0, falharam: 0 });
  });
  it("conta passados e falhados", () => {
    const r: ResultadoTeste[] = [
      { nome: "a", passou: true },
      { nome: "b", passou: false, erro: "x" },
      { nome: "c", passou: true },
    ];
    expect(resumir(r)).toEqual({ total: 3, passaram: 2, falharam: 1 });
  });
  it("todos passando", () => {
    const r: ResultadoTeste[] = [
      { nome: "a", passou: true },
      { nome: "b", passou: true },
    ];
    expect(resumir(r)).toEqual({ total: 2, passaram: 2, falharam: 0 });
  });
  it("todos falhando", () => {
    const r: ResultadoTeste[] = [
      { nome: "a", passou: false },
      { nome: "b", passou: false },
    ];
    expect(resumir(r)).toEqual({ total: 2, passaram: 0, falharam: 2 });
  });
});

// ---------------------------------------------------------------------------
// mensagemErro
// ---------------------------------------------------------------------------
describe("mensagemErro", () => {
  it("AssertionError mostra so a message (sem nome)", () => {
    expect(mensagemErro(new AssertionError("falhou"))).toBe("falhou");
  });
  it("Error generico inclui nome", () => {
    expect(mensagemErro(new TypeError("xyz"))).toBe("TypeError: xyz");
  });
  it("Error sem nome usa so a message", () => {
    const e = new Error("oi");
    e.name = "";
    expect(mensagemErro(e)).toBe("oi");
  });
  it("string passa direto", () => {
    expect(mensagemErro("texto cru")).toBe("texto cru");
  });
  it("outros valores via String()", () => {
    expect(mensagemErro(42)).toBe("42");
    expect(mensagemErro(null)).toBe("null");
    expect(mensagemErro(undefined)).toBe("undefined");
  });
});

// ---------------------------------------------------------------------------
// AssertionError
// ---------------------------------------------------------------------------
describe("AssertionError", () => {
  it("e Error e tem name correto", () => {
    const e = new AssertionError("m");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AssertionError");
    expect(e.message).toBe("m");
  });
});
