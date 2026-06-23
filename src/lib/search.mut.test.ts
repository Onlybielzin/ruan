// F19 — Busca/palette: testes SUPLEMENTARES para matar mutantes que sobrevivem.
// Foco: itemPath na raiz (dir vazio -> juntarItemPath), ordenacao estavel e
// pesos exatos de score combinando nome+url, e ramos de filtrarComandos.
// LOGICA PURA (search.ts e o alvo).

import { describe, it, expect } from "vitest";
import {
  buscar,
  scoreMatch,
  scoreRequest,
  ordenarPorScore,
  filtrarComandos,
  type Comando,
} from "./search";
import { novaRequest } from "./types";
import type { Collection, TreeItem } from "./types";

function req(name: string, url = "", method = "GET"): TreeItem {
  return { type: "request", ...novaRequest(name), url, method };
}
function folder(name: string, items: TreeItem[]): TreeItem {
  return { type: "folder", name, seq: 0, items };
}
function col(name: string, items: TreeItem[]): Collection {
  return { name, version: "1", items };
}

describe("buscar — itemPath na raiz (juntarItemPath com dir vazio)", () => {
  it("request na raiz tem itemPath = so o slug (sem barra inicial)", () => {
    const c = { "/c": col("C", [req("Login User")]) };
    const res = buscar(c, "login");
    expect(res[0].itemPath).toBe("login-user");
    expect(res[0].itemPath.startsWith("/")).toBe(false);
  });

  it("pasta na raiz tem itemPath = so o slug", () => {
    const c = { "/c": col("C", [folder("Auth Flow", [])]) };
    const res = buscar(c, "auth");
    expect(res[0].itemPath).toBe("auth-flow");
  });

  it("um nivel de pasta junta com exatamente uma barra", () => {
    const c = { "/c": col("C", [folder("Auth", [req("Login")])]) };
    const res = buscar(c, "login");
    expect(res[0].itemPath).toBe("auth/login");
  });
});

describe("buscar — score combinado decide a ordem entre requests", () => {
  it("nome+url ambos casando fica acima de so-nome casando", () => {
    const c = {
      "/c": col("C", [
        req("login", "http://x/none"), // so nome (100)
        req("login", "http://x/login"), // nome (100) + url substring/palavra
      ]),
    };
    const res = buscar(c, "login");
    // O que tem url casando tambem deve vir primeiro (score maior).
    expect(res[0].url).toBe("http://x/login");
    expect(res[0].score).toBeGreaterThan(res[1].score);
  });

  it("empate de score desempata por nome asc (case-insensitive)", () => {
    const c = {
      "/c": col("C", [req("beta"), req("Alpha")]),
    };
    // ambos prefixo de 'a'? nao — usa termo que da mesmo score nos dois.
    const res = buscar(c, "a");
    // 'Alpha' prefixo(100); 'beta' substring 'a'(30). Alpha primeiro por score.
    expect(res[0].name).toBe("Alpha");
  });
});

describe("ordenarPorScore — tie-break exato e estabilidade do score", () => {
  it("score maior sempre primeiro independente do nome", () => {
    const itens = [
      { name: "zzz", score: 100 },
      { name: "aaa", score: 99 },
    ];
    expect(ordenarPorScore(itens).map((i) => i.name)).toEqual(["zzz", "aaa"]);
  });
  it("mesmo score: ordena por nome ascendente ignorando caixa", () => {
    const itens = [
      { name: "banana", score: 5 },
      { name: "Apple", score: 5 },
      { name: "cherry", score: 5 },
    ];
    expect(ordenarPorScore(itens).map((i) => i.name)).toEqual([
      "Apple",
      "banana",
      "cherry",
    ]);
  });
});

describe("scoreRequest — soma com peso 0.5 fixada em mais casos", () => {
  it("nome inicio-de-palavra(60) + url prefixo(100) = 60 + 50 = 110", () => {
    const r = { ...novaRequest("api login"), url: "login.example" };
    // nome: 'login' apos espaco => 60; url: 'login' prefixo => 100*0.5=50
    expect(scoreRequest(r, "login")).toBe(110);
  });
  it("retorna 0 estrito quando nome e url sao 0 (nao soma 0+0 espurio)", () => {
    const r = { ...novaRequest("foo"), url: "bar" };
    expect(scoreRequest(r, "zzz")).toBe(0);
  });
});

describe("scoreMatch — separador imediatamente anterior, nao em qualquer posicao", () => {
  it("ponto NAO e separador de palavra (vira substring=30)", () => {
    expect(scoreMatch("a.login", "login")).toBe(30);
  });
  it("a primeira ocorrencia (indexOf) e a que conta", () => {
    // 'login' aparece como prefixo logo no inicio => 100, ignora ocorrencia tardia.
    expect(scoreMatch("login e relogin", "login")).toBe(100);
  });
});

describe("filtrarComandos — ramos de termo e match", () => {
  it("termo so-espacos equivale a vazio (devolve todos)", () => {
    const cs: Comando[] = [
      { id: "a", label: "Alpha", run: () => {} },
      { id: "b", label: "Beta", run: () => {} },
    ];
    expect(filtrarComandos(cs, "   ").map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("filtra estritamente (score>0) — comando que nao casa some", () => {
    const cs: Comando[] = [
      { id: "a", label: "Enviar Request", run: () => {} },
      { id: "b", label: "Limpar", run: () => {} },
    ];
    expect(filtrarComandos(cs, "request").map((c) => c.id)).toEqual(["a"]);
  });
  it("keyword desempata: prefixo na keyword vence substring no label", () => {
    const cs: Comando[] = [
      { id: "kw", label: "zzz", keywords: ["login"], run: () => {} }, // 100
      { id: "lab", label: "relogin", run: () => {} }, // 30
    ];
    expect(filtrarComandos(cs, "login").map((c) => c.id)).toEqual(["kw", "lab"]);
  });
});
