// F15 — Testes da logica PURA das abas (multi-request). Alvo de mutation.
// Cobre: estado vazio, idDaAba (salva vs avulsa), indiceDe/abaAtiva, abrir
// (dedupe), fechar (reativa vizinha), ativar, marcarSujo (no-op estavel),
// atualizarRequestDaAba, reordenar (clamp/no-op) e persistencia (ida/volta,
// tolerancia a lixo). Imutabilidade verificada onde importa.

import { describe, it, expect } from "vitest";
import { novaRequest } from "./types";
import type { RequestItem } from "./types";
import {
  estadoVazio,
  idDaAba,
  indiceDe,
  abaAtiva,
  abrir,
  fechar,
  ativar,
  marcarSujo,
  atualizarRequestDaAba,
  reordenar,
  paraPersistir,
  dePersistido,
  type Tab,
  type TabsState,
} from "./tabs";

// --- helpers de fixture -----------------------------------------------------

function fazAba(
  id: string,
  over: Partial<Tab> = {},
): Tab {
  return {
    id,
    collectionPath: over.collectionPath ?? null,
    itemPath: over.itemPath ?? null,
    title: over.title ?? id,
    request: over.request ?? novaRequest(over.title ?? id),
    sujo: over.sujo ?? false,
  };
}

/** Monta um estado a partir de uma lista de abas, ativando a `activeId` dada. */
function fazEstado(tabs: Tab[], activeId: string | null): TabsState {
  return { tabs, activeId };
}

// ---------------------------------------------------------------------------

describe("estadoVazio", () => {
  it("comeca sem abas e sem ativa", () => {
    const s = estadoVazio();
    expect(s.tabs).toEqual([]);
    expect(s.activeId).toBeNull();
  });

  it("devolve um novo objeto a cada chamada (nao compartilha referencia)", () => {
    const a = estadoVazio();
    const b = estadoVazio();
    expect(a).not.toBe(b);
    expect(a.tabs).not.toBe(b.tabs);
  });
});

describe("idDaAba", () => {
  it("salva: combina collectionPath e itemPath com '::'", () => {
    expect(idDaAba("col/api", "users/get")).toBe("col/api::users/get");
  });

  it("salva: ids diferem quando o itemPath difere", () => {
    expect(idDaAba("c", "a")).not.toBe(idDaAba("c", "b"));
  });

  it("salva: ids diferem quando a colecao difere", () => {
    expect(idDaAba("c1", "a")).not.toBe(idDaAba("c2", "a"));
  });

  it("avulsa (ambos null): usa o nonce", () => {
    expect(idDaAba(null, null, "abc")).toBe("avulsa::abc");
  });

  it("avulsa: nonces diferentes geram ids diferentes (nao deduplica)", () => {
    expect(idDaAba(null, null, "1")).not.toBe(idDaAba(null, null, "2"));
  });

  it("avulsa: sem nonce cai no fallback '0'", () => {
    expect(idDaAba(null, null)).toBe("avulsa::0");
  });

  it("avulsa quando so collectionPath e null", () => {
    expect(idDaAba(null, "x", "n")).toBe("avulsa::n");
  });

  it("avulsa quando so itemPath e null", () => {
    expect(idDaAba("c", null, "n")).toBe("avulsa::n");
  });
});

describe("indiceDe", () => {
  it("acha o indice da aba pelo id", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    expect(indiceDe(s, "a")).toBe(0);
    expect(indiceDe(s, "b")).toBe(1);
    expect(indiceDe(s, "c")).toBe(2);
  });

  it("retorna -1 para id ausente", () => {
    const s = fazEstado([fazAba("a")], "a");
    expect(indiceDe(s, "zzz")).toBe(-1);
  });

  it("retorna -1 em estado vazio", () => {
    expect(indiceDe(estadoVazio(), "a")).toBe(-1);
  });
});

describe("abaAtiva", () => {
  it("retorna a aba cujo id e o activeId", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "b");
    expect(abaAtiva(s)?.id).toBe("b");
  });

  it("retorna undefined quando activeId e null", () => {
    const s = fazEstado([fazAba("a")], null);
    expect(abaAtiva(s)).toBeUndefined();
  });

  it("retorna undefined quando activeId nao corresponde a nenhuma aba", () => {
    const s = fazEstado([fazAba("a")], "fantasma");
    expect(abaAtiva(s)).toBeUndefined();
  });
});

describe("abrir", () => {
  it("anexa nova aba no fim e a ativa", () => {
    const s0 = estadoVazio();
    const s1 = abrir(s0, fazAba("a"));
    expect(s1.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(s1.activeId).toBe("a");

    const s2 = abrir(s1, fazAba("b"));
    expect(s2.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(s2.activeId).toBe("b");
  });

  it("dedupe: id existente nao duplica, apenas ativa", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "a");
    const r = abrir(s, fazAba("b"));
    expect(r.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(r.tabs.length).toBe(2);
    expect(r.activeId).toBe("b");
  });

  it("dedupe: preserva o snapshot/sujo existente (nao sobrescreve edicao)", () => {
    const req0 = novaRequest("original");
    const existente = fazAba("a", { request: req0, sujo: true, title: "original" });
    const s = fazEstado([existente], "a");

    const req1 = novaRequest("novo");
    const r = abrir(s, fazAba("a", { request: req1, sujo: false, title: "novo" }));

    // mantem a aba original intacta (mesmo objeto), nao a nova
    expect(r.tabs[0]).toBe(existente);
    expect(r.tabs[0].title).toBe("original");
    expect(r.tabs[0].sujo).toBe(true);
  });

  it("nao muta o estado de entrada", () => {
    const s = fazEstado([fazAba("a")], "a");
    const antes = s.tabs.length;
    abrir(s, fazAba("b"));
    expect(s.tabs.length).toBe(antes);
    expect(s.activeId).toBe("a");
  });
});

describe("fechar", () => {
  it("remove a aba e mantem as demais na ordem", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    const r = fechar(s, "b");
    expect(r.tabs.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("fechar a ativa do meio reativa a vizinha a direita", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "b");
    const r = fechar(s, "b");
    expect(r.activeId).toBe("c");
  });

  it("fechar a ativa da ponta direita reativa a a esquerda (ultima)", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "c");
    const r = fechar(s, "c");
    expect(r.activeId).toBe("b");
  });

  it("fechar uma nao-ativa mantem a ativa atual", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    const r = fechar(s, "c");
    expect(r.activeId).toBe("a");
  });

  it("fechar a unica aba zera a ativa", () => {
    const s = fazEstado([fazAba("a")], "a");
    const r = fechar(s, "a");
    expect(r.tabs).toEqual([]);
    expect(r.activeId).toBeNull();
  });

  it("id inexistente: retorna o mesmo estado (referencia)", () => {
    const s = fazEstado([fazAba("a")], "a");
    expect(fechar(s, "zzz")).toBe(s);
  });

  it("nao muta a lista de entrada", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "a");
    fechar(s, "a");
    expect(s.tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("ativar", () => {
  it("ativa uma aba existente", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "a");
    expect(ativar(s, "b").activeId).toBe("b");
  });

  it("preserva a lista de abas (mesma referencia de array)", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "a");
    expect(ativar(s, "b").tabs).toBe(s.tabs);
  });

  it("id ausente: retorna o estado original (referencia)", () => {
    const s = fazEstado([fazAba("a")], "a");
    expect(ativar(s, "zzz")).toBe(s);
  });
});

describe("marcarSujo", () => {
  it("marca uma aba limpa como suja", () => {
    const s = fazEstado([fazAba("a", { sujo: false })], "a");
    const r = marcarSujo(s, "a", true);
    expect(r.tabs[0].sujo).toBe(true);
  });

  it("marca uma aba suja como limpa", () => {
    const s = fazEstado([fazAba("a", { sujo: true })], "a");
    const r = marcarSujo(s, "a", false);
    expect(r.tabs[0].sujo).toBe(false);
  });

  it("no-op estavel: ja no estado desejado retorna a MESMA referencia", () => {
    const s = fazEstado([fazAba("a", { sujo: true })], "a");
    expect(marcarSujo(s, "a", true)).toBe(s);
  });

  it("so altera a aba alvo, mantendo as demais intactas", () => {
    const outra = fazAba("b", { sujo: false });
    const s = fazEstado([fazAba("a", { sujo: false }), outra], "a");
    const r = marcarSujo(s, "a", true);
    expect(r.tabs[1]).toBe(outra); // referencia preservada
    expect(r.tabs[0].sujo).toBe(true);
  });

  it("id ausente: retorna o estado original (referencia)", () => {
    const s = fazEstado([fazAba("a")], "a");
    expect(marcarSujo(s, "zzz", true)).toBe(s);
  });

  it("preserva activeId", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "b");
    expect(marcarSujo(s, "a", true).activeId).toBe("b");
  });

  it("nao muta a aba de entrada", () => {
    const aba = fazAba("a", { sujo: false });
    const s = fazEstado([aba], "a");
    marcarSujo(s, "a", true);
    expect(aba.sujo).toBe(false);
  });
});

describe("atualizarRequestDaAba", () => {
  it("troca o snapshot da aba", () => {
    const novo: RequestItem = novaRequest("X");
    novo.method = "POST";
    const s = fazEstado([fazAba("a")], "a");
    const r = atualizarRequestDaAba(s, "a", novo);
    expect(r.tabs[0].request).toBe(novo);
    expect(r.tabs[0].request.method).toBe("POST");
  });

  it("marca suja por padrao", () => {
    const s = fazEstado([fazAba("a", { sujo: false })], "a");
    const r = atualizarRequestDaAba(s, "a", novaRequest("X"));
    expect(r.tabs[0].sujo).toBe(true);
  });

  it("sujo:false explicito (caso salvar) limpa o dot", () => {
    const s = fazEstado([fazAba("a", { sujo: true })], "a");
    const r = atualizarRequestDaAba(s, "a", novaRequest("X"), false);
    expect(r.tabs[0].sujo).toBe(false);
  });

  it("usa request.name como novo titulo quando presente", () => {
    const s = fazEstado([fazAba("a", { title: "antigo" })], "a");
    const r = atualizarRequestDaAba(s, "a", novaRequest("NovoNome"));
    expect(r.tabs[0].title).toBe("NovoNome");
  });

  it("mantem o titulo antigo se request.name for vazio", () => {
    const s = fazEstado([fazAba("a", { title: "antigo" })], "a");
    const reqSemNome = novaRequest("");
    const r = atualizarRequestDaAba(s, "a", reqSemNome);
    expect(r.tabs[0].title).toBe("antigo");
  });

  it("so altera a aba alvo, preservando as outras", () => {
    const outra = fazAba("b");
    const s = fazEstado([fazAba("a"), outra], "a");
    const r = atualizarRequestDaAba(s, "a", novaRequest("X"));
    expect(r.tabs[1]).toBe(outra);
  });

  it("id ausente: retorna o estado original (referencia)", () => {
    const s = fazEstado([fazAba("a")], "a");
    expect(atualizarRequestDaAba(s, "zzz", novaRequest("X"))).toBe(s);
  });

  it("preserva activeId", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "b");
    expect(atualizarRequestDaAba(s, "a", novaRequest("X")).activeId).toBe("b");
  });
});

describe("reordenar", () => {
  it("move da posicao from para to (esquerda -> direita)", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    const r = reordenar(s, 0, 2);
    expect(r.tabs.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("move da direita para a esquerda", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    const r = reordenar(s, 2, 0);
    expect(r.tabs.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("move para o meio", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    const r = reordenar(s, 0, 1);
    expect(r.tabs.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("no-op quando from === to (referencia preservada)", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "a");
    expect(reordenar(s, 1, 1)).toBe(s);
  });

  it("clampa indices fora do intervalo (to alto vira ultimo)", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    const r = reordenar(s, 0, 99);
    expect(r.tabs.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("clampa indices negativos (from negativo vira 0)", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    const r = reordenar(s, -5, 2);
    expect(r.tabs.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("clamp que colapsa em from===to vira no-op (referencia)", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "a");
    // ambos clampam para 1 -> origem===destino -> no-op
    expect(reordenar(s, 5, 9)).toBe(s);
  });

  it("estado vazio: retorna o mesmo estado (referencia)", () => {
    const s = estadoVazio();
    expect(reordenar(s, 0, 1)).toBe(s);
  });

  it("preserva activeId apos reordenar", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "b");
    expect(reordenar(s, 0, 2).activeId).toBe("b");
  });

  it("nao muta a lista de entrada", () => {
    const s = fazEstado([fazAba("a"), fazAba("b"), fazAba("c")], "a");
    reordenar(s, 0, 2);
    expect(s.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("paraPersistir", () => {
  it("descarta o snapshot (request) e o flag sujo", () => {
    const s = fazEstado(
      [
        fazAba("a", {
          collectionPath: "col",
          itemPath: "item",
          title: "T",
          sujo: true,
          request: novaRequest("segredo"),
        }),
      ],
      "a",
    );
    const p = paraPersistir(s);
    expect(p.tabs[0]).toEqual({
      id: "a",
      collectionPath: "col",
      itemPath: "item",
      title: "T",
    });
    expect(p.tabs[0]).not.toHaveProperty("request");
    expect(p.tabs[0]).not.toHaveProperty("sujo");
  });

  it("preserva activeId e a ordem", () => {
    const s = fazEstado([fazAba("a"), fazAba("b")], "b");
    const p = paraPersistir(s);
    expect(p.activeId).toBe("b");
    expect(p.tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("estado vazio persiste como tabs:[] e activeId:null", () => {
    const p = paraPersistir(estadoVazio());
    expect(p).toEqual({ tabs: [], activeId: null });
  });
});

describe("dePersistido", () => {
  it("round-trip: paraPersistir -> dePersistido preserva identidade", () => {
    const s = fazEstado(
      [
        fazAba("a", { collectionPath: "c1", itemPath: "i1", title: "A" }),
        fazAba("b", { collectionPath: "c2", itemPath: "i2", title: "B" }),
      ],
      "b",
    );
    const back = dePersistido(paraPersistir(s));
    expect(back.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(back.activeId).toBe("b");
    expect(back.tabs[0]).toEqual({
      id: "a",
      collectionPath: "c1",
      itemPath: "i1",
      title: "A",
    });
  });

  it("null -> estado vazio", () => {
    expect(dePersistido(null)).toEqual({ tabs: [], activeId: null });
  });

  it("tipo primitivo -> estado vazio", () => {
    expect(dePersistido(42)).toEqual({ tabs: [], activeId: null });
    expect(dePersistido("x")).toEqual({ tabs: [], activeId: null });
  });

  it("tabs ausente ou nao-array -> tabs vazio", () => {
    expect(dePersistido({}).tabs).toEqual([]);
    expect(dePersistido({ tabs: "nope" }).tabs).toEqual([]);
  });

  it("descarta entradas null/nao-objeto na lista", () => {
    const r = dePersistido({ tabs: [null, 5, "x", { id: "ok" }], activeId: "ok" });
    expect(r.tabs.map((t) => t.id)).toEqual(["ok"]);
  });

  it("descarta entradas sem id string", () => {
    const r = dePersistido({ tabs: [{ id: 7 }, { title: "no id" }, { id: "ok" }] });
    expect(r.tabs.map((t) => t.id)).toEqual(["ok"]);
  });

  it("campos nao-string viram defaults (null/'')", () => {
    const r = dePersistido({
      tabs: [{ id: "a", collectionPath: 9, itemPath: {}, title: 1 }],
    });
    expect(r.tabs[0]).toEqual({
      id: "a",
      collectionPath: null,
      itemPath: null,
      title: "",
    });
  });

  it("preserva collectionPath/itemPath/title quando sao strings", () => {
    const r = dePersistido({
      tabs: [{ id: "a", collectionPath: "c", itemPath: "i", title: "t" }],
    });
    expect(r.tabs[0]).toEqual({
      id: "a",
      collectionPath: "c",
      itemPath: "i",
      title: "t",
    });
  });

  it("activeId invalido cai para a primeira aba", () => {
    const r = dePersistido({
      tabs: [{ id: "a" }, { id: "b" }],
      activeId: "fantasma",
    });
    expect(r.activeId).toBe("a");
  });

  it("activeId ausente cai para a primeira aba", () => {
    const r = dePersistido({ tabs: [{ id: "a" }, { id: "b" }] });
    expect(r.activeId).toBe("a");
  });

  it("activeId valido e respeitado", () => {
    const r = dePersistido({ tabs: [{ id: "a" }, { id: "b" }], activeId: "b" });
    expect(r.activeId).toBe("b");
  });

  it("sem abas: activeId e null mesmo que venha preenchido", () => {
    const r = dePersistido({ tabs: [], activeId: "x" });
    expect(r.activeId).toBeNull();
  });

  it("nunca lanca em entradas malformadas variadas", () => {
    const lixos: unknown[] = [
      undefined,
      [],
      { tabs: [{}] },
      { tabs: [{ id: null }] },
      { tabs: null, activeId: 1 },
      { activeId: true },
    ];
    for (const l of lixos) {
      expect(() => dePersistido(l)).not.toThrow();
    }
  });
});
