// F6 — Testes da logica PURA do editor de headers (alvo de mutation testing).
// Foco em headers.ts: normalizacao, comparacao case-insensitive, filtro por
// prefixo e deteccao de header conhecido. Casos normais, limites e maliciosos.

import { describe, it, expect } from "vitest";
import {
  HEADER_NAMES_COMUNS,
  normalizarNomeHeader,
  mesmoHeader,
  filtrarSugestoes,
  eHeaderConhecido,
} from "./headers";

describe("HEADER_NAMES_COMUNS", () => {
  it("contem os headers-chave garantidos", () => {
    expect(HEADER_NAMES_COMUNS).toContain("Content-Type");
    expect(HEADER_NAMES_COMUNS).toContain("Authorization");
    expect(HEADER_NAMES_COMUNS).toContain("Accept");
  });

  it("nao tem entradas duplicadas", () => {
    const set = new Set(HEADER_NAMES_COMUNS);
    expect(set.size).toBe(HEADER_NAMES_COMUNS.length);
  });

  it("esta ordenada (ordem de codepoint/ASCII, estavel)", () => {
    // A lista esta em ordem ASCII (ex.: 'DNT' antes de 'Date' porque 'N' < 'a').
    // Verificamos monotonicidade nesse criterio, que e o ordenamento real.
    const ordenada = [...HEADER_NAMES_COMUNS].sort();
    expect([...HEADER_NAMES_COMUNS]).toEqual(ordenada);
  });

  it("nao contem strings vazias nem espacos nas pontas", () => {
    for (const nome of HEADER_NAMES_COMUNS) {
      expect(nome.length).toBeGreaterThan(0);
      expect(nome).toBe(nome.trim());
    }
  });

  it("tem um numero razoavel de headers (perto de ~45)", () => {
    expect(HEADER_NAMES_COMUNS.length).toBeGreaterThanOrEqual(40);
  });
});

describe("normalizarNomeHeader", () => {
  it("remove espacos das pontas", () => {
    expect(normalizarNomeHeader("  Accept ")).toBe("Accept");
  });

  it("remove tabs e quebras de linha das pontas (trim completo)", () => {
    expect(normalizarNomeHeader("\t\nAccept\r\n ")).toBe("Accept");
  });

  it("NAO altera a caixa (preserva o que foi digitado)", () => {
    expect(normalizarNomeHeader("content-TYPE")).toBe("content-TYPE");
    expect(normalizarNomeHeader("  X-Custom  ")).toBe("X-Custom");
  });

  it("nao remove espacos internos", () => {
    expect(normalizarNomeHeader("  a b  ")).toBe("a b");
  });

  it("string vazia ou so espacos vira vazia", () => {
    expect(normalizarNomeHeader("")).toBe("");
    expect(normalizarNomeHeader("     ")).toBe("");
  });

  it("string ja normalizada permanece igual", () => {
    expect(normalizarNomeHeader("Content-Type")).toBe("Content-Type");
  });
});

describe("mesmoHeader", () => {
  it("compara case-insensitive com trim nas pontas", () => {
    expect(mesmoHeader(" content-type ", "Content-Type")).toBe(true);
  });

  it("true para nomes identicos", () => {
    expect(mesmoHeader("Accept", "Accept")).toBe(true);
  });

  it("true para apenas diferenca de caixa", () => {
    expect(mesmoHeader("AUTHORIZATION", "authorization")).toBe(true);
  });

  it("true quando ambos sao vazios apos trim", () => {
    expect(mesmoHeader("   ", "")).toBe(true);
  });

  it("false para nomes diferentes", () => {
    expect(mesmoHeader("Accept", "Accept-Encoding")).toBe(false);
  });

  it("false quando difere por espaco interno", () => {
    expect(mesmoHeader("Content Type", "Content-Type")).toBe(false);
  });

  it("e simetrico", () => {
    expect(mesmoHeader("a", "A")).toBe(mesmoHeader("A", "a"));
  });
});

describe("filtrarSugestoes", () => {
  it("prefixo vazio retorna a lista inteira (mesmo conteudo)", () => {
    const r = filtrarSugestoes("");
    expect(r).toEqual([...HEADER_NAMES_COMUNS]);
  });

  it("prefixo so com espacos (trim vazio) retorna lista inteira", () => {
    const r = filtrarSugestoes("   ");
    expect(r).toEqual([...HEADER_NAMES_COMUNS]);
  });

  it("prefixo vazio retorna NOVO array, nao a referencia base", () => {
    const r = filtrarSugestoes("");
    expect(r).not.toBe(HEADER_NAMES_COMUNS as unknown as string[]);
    // mutar o retorno nao deve afetar a lista base
    r.push("X-Mutado");
    expect(HEADER_NAMES_COMUNS).not.toContain("X-Mutado");
  });

  it("filtra por prefixo case-insensitive", () => {
    const r = filtrarSugestoes("content");
    expect(r).toContain("Content-Type");
    expect(r).toContain("Content-Length");
    // nao deve incluir algo que nao comeca com 'content'
    expect(r).not.toContain("Accept");
  });

  it("match e por prefixo (startsWith), nao por substring", () => {
    // "Type" aparece dentro de "Content-Type" mas nao no inicio
    const r = filtrarSugestoes("Type");
    expect(r).not.toContain("Content-Type");
  });

  it("exclui o item identico ao prefixo ja digitado por completo", () => {
    const r = filtrarSugestoes("Content-Type");
    expect(r).not.toContain("Content-Type");
    // ainda inclui outros que compartilham o prefixo? Content-Type e o unico
    // que casa exatamente; Content-Type nao deve aparecer.
  });

  it("exclusao do item exato e case-insensitive", () => {
    const r = filtrarSugestoes("content-type");
    expect(r).not.toContain("Content-Type");
  });

  it("prefixo parcial mantem o item completo", () => {
    const r = filtrarSugestoes("content-typ");
    expect(r).toContain("Content-Type");
  });

  it("prefixo sem match retorna array vazio", () => {
    const r = filtrarSugestoes("zzz-nao-existe");
    expect(r).toEqual([]);
  });

  it("usa lista custom quando fornecida", () => {
    const custom = ["Foo", "Foobar", "Bar"];
    const r = filtrarSugestoes("foo", custom);
    expect(r).toEqual(["Foobar"]); // "Foo" exato e excluido, "Bar" nao casa
  });

  it("lista custom: prefixo vazio retorna copia da custom", () => {
    const custom = ["A", "B"];
    const r = filtrarSugestoes("", custom);
    expect(r).toEqual(["A", "B"]);
    expect(r).not.toBe(custom);
  });

  it("preserva a ordem da lista base no resultado filtrado", () => {
    const r = filtrarSugestoes("accept");
    // Os itens "Accept-*" devem vir na ordem da lista base
    const esperado = HEADER_NAMES_COMUNS.filter(
      (n) => n.toLowerCase().startsWith("accept") && n.toLowerCase() !== "accept",
    );
    expect(r).toEqual(esperado);
  });

  it("sempre retorna um NOVO array mesmo com filtro", () => {
    const r1 = filtrarSugestoes("content");
    const r2 = filtrarSugestoes("content");
    expect(r1).not.toBe(r2);
    expect(r1).toEqual(r2);
  });

  it("prefixo com espacos nas pontas e trimado antes de filtrar", () => {
    const r = filtrarSugestoes("  content ");
    expect(r).toContain("Content-Type");
  });

  it("nao muta a lista base ao filtrar", () => {
    const antes = [...HEADER_NAMES_COMUNS];
    filtrarSugestoes("content");
    expect([...HEADER_NAMES_COMUNS]).toEqual(antes);
  });

  it("prefixo malicioso com regex chars nao quebra (tratado como literal)", () => {
    // startsWith e literal, nao regex; '.*' nao deve casar tudo
    const r = filtrarSugestoes(".*");
    expect(r).toEqual([]);
  });

  it("lista custom vazia retorna vazio para qualquer prefixo nao-vazio", () => {
    expect(filtrarSugestoes("x", [])).toEqual([]);
  });

  it("lista custom vazia com prefixo vazio retorna copia vazia", () => {
    const r = filtrarSugestoes("", []);
    expect(r).toEqual([]);
  });
});

describe("eHeaderConhecido", () => {
  it("true para header comum, case-insensitive", () => {
    expect(eHeaderConhecido("authorization")).toBe(true);
    expect(eHeaderConhecido("CONTENT-TYPE")).toBe(true);
  });

  it("true com espacos nas pontas", () => {
    expect(eHeaderConhecido("  Accept  ")).toBe(true);
  });

  it("false para header customizado", () => {
    expect(eHeaderConhecido("X-Custom")).toBe(false);
  });

  it("false para string vazia", () => {
    expect(eHeaderConhecido("")).toBe(false);
  });

  it("false para nome parcial (nao e prefixo, e igualdade)", () => {
    expect(eHeaderConhecido("Content")).toBe(false);
  });

  it("usa lista custom quando fornecida", () => {
    expect(eHeaderConhecido("foo", ["Foo", "Bar"])).toBe(true);
    expect(eHeaderConhecido("baz", ["Foo", "Bar"])).toBe(false);
  });

  it("lista custom vazia => sempre false", () => {
    expect(eHeaderConhecido("Accept", [])).toBe(false);
  });

  it("nome com espaco interno que difere nao e conhecido", () => {
    expect(eHeaderConhecido("Content Type")).toBe(false);
  });
});
