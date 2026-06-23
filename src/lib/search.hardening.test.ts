// Testes de ENDURECIMENTO (mutation-killing) da logica PURA de src/lib/search.ts
// (F19). Focam nos pesos de score exatos, ordem prefixo>palavra>substring,
// peso reduzido da url, ordenacao estavel, wrap-around de moverSelecao e
// filtrarComandos (vazio devolve tudo; com termo, casa label e keywords).
import { describe, it, expect } from "vitest";
import {
  scoreMatch,
  scoreRequest,
  buscar,
  ordenarPorScore,
  scoreComando,
  filtrarComandos,
  moverSelecao,
  type Comando,
} from "./search";
import type { Collection, RequestItem, TreeItem } from "./types";
import { novaRequest } from "./types";

function reqItem(name: string, url = "", method = "GET"): TreeItem {
  const r = novaRequest(name);
  r.url = url;
  r.method = method;
  return { type: "request", ...r } as TreeItem;
}

function folder(name: string, items: TreeItem[] = []): TreeItem {
  return { type: "folder", name, seq: 0, items } as TreeItem;
}

function col(name: string, items: TreeItem[]): Collection {
  return { name, items } as Collection;
}

// ---- scoreMatch: pesos e fronteiras -----------------------------------------
describe("scoreMatch", () => {
  it("termo vazio -> 0", () => {
    expect(scoreMatch("qualquer", "")).toBe(0);
  });
  it("nao casa -> 0", () => {
    expect(scoreMatch("abc", "zzz")).toBe(0);
  });
  it("prefixo (idx 0) -> 100", () => {
    expect(scoreMatch("Users list", "users")).toBe(100);
  });
  it("inicio de palavra apos espaco -> 60", () => {
    expect(scoreMatch("list users", "users")).toBe(60);
  });
  it("inicio de palavra apos - _ / -> 60", () => {
    expect(scoreMatch("get-users", "users")).toBe(60);
    expect(scoreMatch("get_users", "users")).toBe(60);
    expect(scoreMatch("api/users", "users")).toBe(60);
  });
  it("substring no meio -> 30", () => {
    expect(scoreMatch("listusers", "users")).toBe(30);
  });
  it("case-insensitive no alvo (termo assumido minusculo)", () => {
    expect(scoreMatch("USERS", "users")).toBe(100);
  });
  it("distingue exatamente os tres pesos", () => {
    expect(scoreMatch("user x", "user")).toBe(100); // prefixo
    expect(scoreMatch("x user", "user")).toBe(60); // palavra
    expect(scoreMatch("xuser", "user")).toBe(30); // substring
  });
});

// ---- scoreRequest: nome + url*0.5 -------------------------------------------
describe("scoreRequest", () => {
  const mk = (name: string, url: string): RequestItem => {
    const r = novaRequest(name);
    r.url = url;
    return r;
  };
  it("zero quando nao casa em nada", () => {
    expect(scoreRequest(mk("a", "b"), "zzz")).toBe(0);
  });
  it("so nome", () => {
    expect(scoreRequest(mk("users", "http://x"), "users")).toBe(100);
  });
  it("so url com peso 0.5", () => {
    expect(scoreRequest(mk("xyz", "http://api/users"), "users")).toBe(60 * 0.5);
  });
  it("soma nome + url*0.5", () => {
    // nome prefixo (100) + url substring (30*0.5=15) = 115
    expect(scoreRequest(mk("users", "http://aXusers"), "users")).toBe(115);
  });
});

// ---- buscar: varredura recursiva, termo trim/lower, vazio -------------------
describe("buscar", () => {
  it("termo vazio ou so espacos -> []", () => {
    const c = { c1: col("C", [reqItem("Users")]) };
    expect(buscar(c, "")).toEqual([]);
    expect(buscar(c, "   ")).toEqual([]);
  });
  it("acha request por nome e por url", () => {
    const c = {
      c1: col("C", [reqItem("Listagem", "http://api/users")]),
    };
    const r = buscar(c, "users");
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe("request");
    expect(r[0].url).toBe("http://api/users");
  });
  it("acha pasta por nome e desce nos filhos", () => {
    const c = {
      c1: col("C", [folder("Admin", [reqItem("Admin users")])]),
    };
    const r = buscar(c, "admin");
    // pasta "Admin" + request "Admin users" (ambos casam)
    expect(r.map((x) => x.tipo).sort()).toEqual(["folder", "request"]);
  });
  it("itemPath de request aninhada usa slugs unidos por /", () => {
    const c = {
      c1: col("C", [folder("My Folder", [reqItem("Get User")])]),
    };
    const r = buscar(c, "get user");
    const reqRes = r.find((x) => x.tipo === "request");
    expect(reqRes?.itemPath).toBe("my-folder/get-user");
  });
  it("ordena por score desc; empate por nome asc", () => {
    const c = {
      c1: col("C", [
        reqItem("zzz users"), // palavra=60
        reqItem("users zzz"), // prefixo=100
        reqItem("aaa users"), // palavra=60
      ]),
    };
    const r = buscar(c, "users");
    expect(r[0].name).toBe("users zzz"); // maior score primeiro
    // empate (60): "aaa users" antes de "zzz users"
    expect(r[1].name).toBe("aaa users");
    expect(r[2].name).toBe("zzz users");
  });
  it("varias colecoes, pula entradas nulas", () => {
    const c = {
      c1: col("C1", [reqItem("Users one")]),
      c2: undefined as unknown as Collection,
      c3: col("C3", [reqItem("Users three")]),
    };
    const r = buscar(c, "users");
    expect(r).toHaveLength(2);
  });
  it("nada casa -> []", () => {
    const c = { c1: col("C", [reqItem("Pets")]) };
    expect(buscar(c, "users")).toEqual([]);
  });
});

// ---- ordenarPorScore: nao muta a entrada, ordem estavel ---------------------
describe("ordenarPorScore", () => {
  it("ordena desc por score e nao muta o array original", () => {
    const arr = [
      { score: 30, name: "b" },
      { score: 100, name: "a" },
    ];
    const out = ordenarPorScore(arr);
    expect(out.map((x) => x.name)).toEqual(["a", "b"]);
    expect(arr.map((x) => x.name)).toEqual(["b", "a"]); // original intacto
  });
  it("empate por nome asc case-insensitive", () => {
    const out = ordenarPorScore([
      { score: 10, name: "Zeta" },
      { score: 10, name: "alpha" },
    ]);
    expect(out.map((x) => x.name)).toEqual(["alpha", "Zeta"]);
  });
});

// ---- scoreComando: melhor entre label e keywords ----------------------------
describe("scoreComando", () => {
  const mk = (label: string, keywords?: string[]): Comando => ({
    id: "x",
    label,
    keywords,
    run: () => {},
  });
  it("usa o label", () => {
    expect(scoreComando(mk("Send request"), "send")).toBe(100);
  });
  it("keyword bate mais forte que label fraco", () => {
    // label substring (30) vs keyword prefixo (100) -> 100
    expect(scoreComando(mk("xenviar", ["enviar"]), "enviar")).toBe(100);
  });
  it("0 quando nada casa", () => {
    expect(scoreComando(mk("abc", ["def"]), "zzz")).toBe(0);
  });
});

// ---- filtrarComandos: vazio devolve tudo (copia); com termo filtra/ordena ----
describe("filtrarComandos", () => {
  const cmds: Comando[] = [
    { id: "1", label: "Send request", run: () => {} },
    { id: "2", label: "Save", keywords: ["salvar"], run: () => {} },
    { id: "3", label: "New collection", run: () => {} },
  ];
  it("termo vazio devolve TODOS na ordem original, mas como copia", () => {
    const out = filtrarComandos(cmds, "");
    expect(out.map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(out).not.toBe(cmds);
  });
  it("termo so-espacos tambem devolve tudo", () => {
    expect(filtrarComandos(cmds, "  ").map((c) => c.id)).toEqual(["1", "2", "3"]);
  });
  it("filtra os que nao casam", () => {
    const out = filtrarComandos(cmds, "save");
    expect(out.map((c) => c.id)).toEqual(["2"]);
  });
  it("casa via keyword", () => {
    const out = filtrarComandos(cmds, "salvar");
    expect(out.map((c) => c.id)).toEqual(["2"]);
  });
  it("ordena por score desc, label asc no empate", () => {
    const lista: Comando[] = [
      { id: "a", label: "x new", run: () => {} }, // palavra=60
      { id: "b", label: "new thing", run: () => {} }, // prefixo=100
      { id: "c", label: "y new", run: () => {} }, // palavra=60
    ];
    const out = filtrarComandos(lista, "new");
    expect(out[0].id).toBe("b");
    expect(out[1].id).toBe("a"); // "x new" antes de "y new"
    expect(out[2].id).toBe("c");
  });
});

// ---- moverSelecao: wrap-around ----------------------------------------------
describe("moverSelecao", () => {
  it("lista vazia -> 0", () => {
    expect(moverSelecao(0, 1, 0)).toBe(0);
    expect(moverSelecao(5, -3, 0)).toBe(0);
  });
  it("avanca dentro do range", () => {
    expect(moverSelecao(0, 1, 3)).toBe(1);
  });
  it("passa do fim volta ao inicio", () => {
    expect(moverSelecao(2, 1, 3)).toBe(0);
  });
  it("retrocede do inicio vai ao fim", () => {
    expect(moverSelecao(0, -1, 3)).toBe(2);
  });
  it("delta grande tambem faz wrap correto", () => {
    expect(moverSelecao(0, 5, 3)).toBe(2);
    expect(moverSelecao(0, -5, 3)).toBe(1);
  });
});

// ---- SEGURANCA: sem ReDoS (indexOf, nao regex) ------------------------------
describe("seguranca", () => {
  it("termo com metacaracteres de regex e tratado literalmente", () => {
    // se fosse regex, "(" sem fechar lancaria; indexOf nao
    expect(scoreMatch("a(b)c", "(b)")).toBe(30);
    expect(scoreMatch("normal", ".*")).toBe(0);
  });
});
