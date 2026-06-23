import { describe, it, expect, vi } from "vitest";
import {
  buscar,
  scoreMatch,
  scoreRequest,
  ordenarPorScore,
  filtrarComandos,
  scoreComando,
  moverSelecao,
  type Comando,
} from "./search";
import { novaRequest } from "./types";
import type { Collection, RequestItem, TreeItem } from "./types";

function req(name: string, url = "", method = "GET"): TreeItem {
  return { type: "request", ...novaRequest(name), url, method };
}

function folder(name: string, items: TreeItem[]): TreeItem {
  return { type: "folder", name, seq: 0, items };
}

function col(name: string, items: TreeItem[]): Collection {
  return { name, version: "1", items };
}

describe("scoreMatch", () => {
  it("retorna 0 para termo vazio", () => {
    expect(scoreMatch("qualquer", "")).toBe(0);
  });

  it("retorna 0 quando nao casa", () => {
    expect(scoreMatch("login", "xyz")).toBe(0);
  });

  it("prefixo bate mais forte que inicio-de-palavra que substring", () => {
    const prefixo = scoreMatch("login user", "login");
    const palavra = scoreMatch("create login", "login");
    const substring = scoreMatch("relogin", "login");
    expect(prefixo).toBeGreaterThan(palavra);
    expect(palavra).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  it("e case-insensitive no alvo (termo ja minusculo)", () => {
    expect(scoreMatch("LOGIN", "login")).toBe(scoreMatch("login", "login"));
  });

  it("reconhece varios separadores como inicio de palavra", () => {
    expect(scoreMatch("a-login", "login")).toBe(scoreMatch("a login", "login"));
    expect(scoreMatch("a_login", "login")).toBe(scoreMatch("a/login", "login"));
    expect(scoreMatch("a_login", "login")).toBeGreaterThan(
      scoreMatch("alogin", "login"),
    );
  });

  it("a barra '/' conta como separador de palavra (nao substring)", () => {
    // Fixa o ramo `anterior === "/"`; deve valer mais que substring no meio.
    expect(scoreMatch("api/login", "login")).toBe(scoreMatch("api login", "login"));
    expect(scoreMatch("api/login", "login")).toBeGreaterThan(
      scoreMatch("apilogin", "login"),
    );
  });

  it("fixa os valores absolutos de score: prefixo=100, palavra=60, substring=30", () => {
    expect(scoreMatch("login x", "login")).toBe(100);
    expect(scoreMatch("a login", "login")).toBe(60);
    expect(scoreMatch("relogin", "login")).toBe(30);
  });

  it("separador deve ser o caractere IMEDIATAMENTE anterior (idx-1)", () => {
    // "a x-login": o '-' esta antes de 'login'; ainda e inicio de palavra.
    expect(scoreMatch("x-login", "login")).toBe(60);
    // Caractere comum antes (letra) => substring.
    expect(scoreMatch("xlogin", "login")).toBe(30);
  });
});

describe("scoreRequest", () => {
  it("0 quando nem nome nem url casam", () => {
    expect(scoreRequest(novaRequest("foo"), "bar")).toBe(0);
  });

  it("nome casando vale mais que so url casando", () => {
    const porNome = scoreRequest(
      { ...novaRequest("login"), url: "http://x" },
      "login",
    );
    const porUrl = scoreRequest(
      { ...novaRequest("foo"), url: "http://login.x" },
      "login",
    );
    expect(porNome).toBeGreaterThan(porUrl);
    expect(porUrl).toBeGreaterThan(0);
  });

  it("soma nome + url quando ambos casam (url com peso reduzido)", () => {
    const r: RequestItem = { ...novaRequest("login"), url: "http://login" };
    const soNome = scoreRequest({ ...novaRequest("login"), url: "" }, "login");
    expect(scoreRequest(r, "login")).toBeGreaterThan(soNome);
  });

  it("url contribui com exatamente metade do peso (PESO_URL=0.5)", () => {
    // nome=prefixo(100), url tem 'login' como substring no meio (30) => 100 + 30*0.5 = 115
    const r: RequestItem = { ...novaRequest("login"), url: "http://x/relogin" };
    expect(scoreRequest(r, "login")).toBe(115);
  });

  it("so url casando devolve url*0.5 (sem o nome)", () => {
    const r: RequestItem = { ...novaRequest("zzz"), url: "http://login.x" };
    // url: 'login' como inicio-de-palavra apos '/' => 60; nome=0 => 60*0.5 = 30
    expect(scoreRequest(r, "login")).toBe(30);
  });
});

describe("ordenarPorScore", () => {
  it("ordena por score desc e empate por nome asc", () => {
    const itens = [
      { name: "Beta", score: 10 },
      { name: "Alpha", score: 10 },
      { name: "Gamma", score: 50 },
    ];
    expect(ordenarPorScore(itens).map((i) => i.name)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
    ]);
  });

  it("nao muta o array original", () => {
    const itens = [
      { name: "B", score: 1 },
      { name: "A", score: 2 },
    ];
    const copia = [...itens];
    ordenarPorScore(itens);
    expect(itens).toEqual(copia);
  });
});

describe("buscar", () => {
  it("termo vazio ou so-espacos => sem resultados", () => {
    const c = { "/c": col("C", [req("Login")]) };
    expect(buscar(c, "")).toEqual([]);
    expect(buscar(c, "   ")).toEqual([]);
  });

  it("acha request por nome com itemPath estavel", () => {
    const c = { "/c": col("C", [folder("Auth", [req("Login User")])]) };
    const res = buscar(c, "login");
    expect(res).toHaveLength(1);
    expect(res[0].tipo).toBe("request");
    expect(res[0].itemPath).toBe("auth/login-user");
    expect(res[0].collectionPath).toBe("/c");
    expect(res[0].collectionName).toBe("C");
    expect(res[0].name).toBe("Login User");
    expect(res[0].request).toBeDefined();
  });

  it("acha request por url", () => {
    const c = { "/c": col("C", [req("Foo", "https://api.example.com/users")]) };
    const res = buscar(c, "example");
    expect(res).toHaveLength(1);
    expect(res[0].url).toContain("example");
  });

  it("acha pasta por nome e desce nos filhos", () => {
    const c = { "/c": col("C", [folder("Login Flow", [req("Login Step")])]) };
    const res = buscar(c, "login");
    expect(res.map((r) => r.tipo).sort()).toEqual(["folder", "request"]);
    const pasta = res.find((r) => r.tipo === "folder")!;
    expect(pasta.itemPath).toBe("login-flow");
    expect(pasta.request).toBeUndefined();
    expect(pasta.url).toBe("");
  });

  it("e case-insensitive", () => {
    const c = { "/c": col("C", [req("LOGIN")]) };
    expect(buscar(c, "login")).toHaveLength(1);
    expect(buscar(c, "LOGIN")).toHaveLength(1);
  });

  it("varre multiplas colecoes", () => {
    const c = {
      "/a": col("A", [req("Login A")]),
      "/b": col("B", [req("Login B")]),
    };
    const res = buscar(c, "login");
    expect(res.map((r) => r.collectionPath).sort()).toEqual(["/a", "/b"]);
  });

  it("ordena prefixo antes de substring", () => {
    const c = { "/c": col("C", [req("relogin"), req("login now")]) };
    const res = buscar(c, "login");
    expect(res[0].name).toBe("login now");
  });

  it("ignora entradas de colecao undefined sem quebrar", () => {
    const c = { "/c": undefined } as unknown as Record<string, Collection>;
    expect(buscar(c, "x")).toEqual([]);
  });

  it("acha em pasta aninhada com itemPath completo", () => {
    const c = { "/c": col("C", [folder("A", [folder("B", [req("Alvo")])])]) };
    const res = buscar(c, "alvo");
    expect(res[0].itemPath).toBe("a/b/alvo");
  });

  it("colecao vazia (sem keys) => sem resultados", () => {
    expect(buscar({}, "login")).toEqual([]);
  });

  it("exclui itens que nao casam (score > 0 e estrito)", () => {
    const c = { "/c": col("C", [req("Login"), req("Outro")]) };
    const res = buscar(c, "login");
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("Login");
  });

  it("preenche method e url da request encontrada", () => {
    const c = { "/c": col("C", [req("Login", "http://api/login", "POST")]) };
    const res = buscar(c, "login");
    expect(res[0].method).toBe("POST");
    expect(res[0].url).toBe("http://api/login");
  });

  it("pasta que casa tem url e method vazios e sem request", () => {
    const c = { "/c": col("C", [folder("Login", [])]) };
    const res = buscar(c, "login");
    expect(res[0].tipo).toBe("folder");
    expect(res[0].method).toBe("");
    expect(res[0].request).toBeUndefined();
  });
});

describe("scoreComando", () => {
  const cmd = (label: string, keywords?: string[]): Comando => ({
    id: label,
    label,
    keywords,
    run: () => {},
  });

  it("casa pelo label", () => {
    expect(scoreComando(cmd("Nova Request"), "request")).toBeGreaterThan(0);
  });

  it("casa por keyword quando o label nao casa", () => {
    expect(scoreComando(cmd("Send", ["enviar"]), "enviar")).toBeGreaterThan(0);
  });

  it("pega o melhor entre label e keywords", () => {
    const c = cmd("zzz enviar", ["enviar"]); // keyword bate como prefixo
    const soLabel = scoreComando(cmd("zzz enviar"), "enviar");
    expect(scoreComando(c, "enviar")).toBeGreaterThan(soLabel);
  });

  it("0 quando nada casa", () => {
    expect(scoreComando(cmd("Nova Request"), "xyz")).toBe(0);
  });

  it("mantem o melhor do label se a keyword pontuar IGUAL (nao troca em empate)", () => {
    // label = prefixo(100); keyword tambem prefixo(100). Resultado fixo 100.
    expect(scoreComando(cmd("login", ["login outra"]), "login")).toBe(100);
  });

  it("usa a keyword quando ela pontua ESTRITAMENTE mais que o label", () => {
    // label: 'enviar' substring no meio (30); keyword: prefixo (100).
    expect(scoreComando(cmd("zzenviar", ["enviar agora"]), "enviar")).toBe(100);
  });

  it("sem keywords usa so o label (lista vazia nao quebra)", () => {
    expect(scoreComando(cmd("login"), "login")).toBe(100);
  });
});

describe("filtrarComandos", () => {
  const comandos: Comando[] = [
    { id: "a", label: "Nova Request", run: () => {} },
    { id: "b", label: "Nova Colecao", run: () => {} },
    { id: "c", label: "Enviar", keywords: ["send", "request"], run: () => {} },
  ];

  it("termo vazio devolve todos na ordem original", () => {
    expect(filtrarComandos(comandos, "").map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("nao muta o array original", () => {
    const copia = [...comandos];
    filtrarComandos(comandos, "");
    expect(comandos).toEqual(copia);
  });

  it("filtra os que casam", () => {
    const res = filtrarComandos(comandos, "nova");
    expect(res.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("casa por keyword", () => {
    const res = filtrarComandos(comandos, "send");
    expect(res.map((c) => c.id)).toEqual(["c"]);
  });

  it("ordena por score desc / label asc", () => {
    const cs: Comando[] = [
      { id: "sub", label: "relogin", run: () => {} },
      { id: "pre", label: "login agora", run: () => {} },
    ];
    expect(filtrarComandos(cs, "login").map((c) => c.id)).toEqual([
      "pre",
      "sub",
    ]);
  });
});

describe("moverSelecao", () => {
  it("avanca e retrocede dentro dos limites", () => {
    expect(moverSelecao(0, 1, 3)).toBe(1);
    expect(moverSelecao(2, -1, 3)).toBe(1);
  });

  it("faz wrap-around no fim e no inicio", () => {
    expect(moverSelecao(2, 1, 3)).toBe(0);
    expect(moverSelecao(0, -1, 3)).toBe(2);
  });

  it("lista vazia => 0", () => {
    expect(moverSelecao(0, 1, 0)).toBe(0);
    expect(moverSelecao(5, -1, 0)).toBe(0);
  });

  it("n negativo (<= 0) tratado como vazio => 0", () => {
    expect(moverSelecao(2, 1, -1)).toBe(0);
  });

  it("wrap com delta grande positivo", () => {
    // 0 + 7 = 7, 7 % 3 = 1
    expect(moverSelecao(0, 7, 3)).toBe(1);
  });

  it("wrap com delta grande negativo (dupla normalizacao)", () => {
    // ((1 + -5) % 3 + 3) % 3 = ((-4)%3 + 3)%3 = (-1+3)%3 = 2
    expect(moverSelecao(1, -5, 3)).toBe(2);
  });

  it("delta zero mantem o indice atual", () => {
    expect(moverSelecao(1, 0, 3)).toBe(1);
  });

  it("executa a acao do comando escolhido (sanidade de tipo)", () => {
    const fn = vi.fn();
    const c: Comando = { id: "x", label: "X", run: fn };
    c.run();
    expect(fn).toHaveBeenCalledOnce();
  });
});
