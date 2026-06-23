import { describe, it, expect } from "vitest";
import { acharRequestPorItemPath, itemPathDe } from "./treeLookup";
import { novaRequest } from "./types";
import type { Collection, TreeItem } from "./types";

function req(name: string): TreeItem {
  return { type: "request", ...novaRequest(name) };
}

function folder(name: string, items: TreeItem[]): TreeItem {
  return { type: "folder", name, seq: 0, items };
}

function col(items: TreeItem[]): Collection {
  return { name: "c", version: "1", items };
}

describe("acharRequestPorItemPath", () => {
  it("retorna null sem colecao", () => {
    expect(acharRequestPorItemPath(undefined, "a")).toBeNull();
  });

  it("retorna null com itemPath null", () => {
    expect(acharRequestPorItemPath(col([req("A")]), null)).toBeNull();
  });

  it("retorna null com itemPath vazio", () => {
    expect(acharRequestPorItemPath(col([req("A")]), "")).toBeNull();
    expect(acharRequestPorItemPath(col([req("A")]), "//")).toBeNull();
  });

  it("acha request na raiz pelo slug", () => {
    const c = col([req("Minha Request")]);
    const r = acharRequestPorItemPath(c, "minha-request");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Minha Request");
  });

  it("acha request dentro de pasta", () => {
    const c = col([folder("API v2", [req("Login")])]);
    const r = acharRequestPorItemPath(c, "api-v2/login");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Login");
  });

  it("acha request em pasta aninhada", () => {
    const c = col([folder("A", [folder("B", [req("C")])])]);
    const r = acharRequestPorItemPath(c, "a/b/c");
    expect(r!.name).toBe("C");
  });

  it("retorna null se pasta intermediaria nao existe", () => {
    const c = col([folder("A", [req("C")])]);
    expect(acharRequestPorItemPath(c, "x/c")).toBeNull();
  });

  it("retorna null se request final nao existe", () => {
    const c = col([folder("A", [req("C")])]);
    expect(acharRequestPorItemPath(c, "a/zzz")).toBeNull();
  });

  it("retorna null se o segmento final casa uma PASTA, nao request", () => {
    const c = col([folder("A", [req("C")])]);
    expect(acharRequestPorItemPath(c, "a")).toBeNull();
  });

  it("nao confunde request de mesmo nome em pasta diferente", () => {
    const c = col([
      folder("A", [req("X")]),
      folder("B", [req("X")]),
    ]);
    expect(acharRequestPorItemPath(c, "a/x")!.name).toBe("X");
    expect(acharRequestPorItemPath(c, "b/x")!.name).toBe("X");
  });
});

describe("itemPathDe", () => {
  it("raiz: so o slug da request", () => {
    expect(itemPathDe(undefined, "Minha Request")).toBe("minha-request");
    expect(itemPathDe("", "Login")).toBe("login");
    expect(itemPathDe("   ", "Login")).toBe("login");
  });

  it("dentro de pasta: dir/slug", () => {
    expect(itemPathDe("api-v2", "Login")).toBe("api-v2/login");
  });

  it("pasta aninhada", () => {
    expect(itemPathDe("a/b", "C")).toBe("a/b/c");
  });

  it("round-trip com acharRequestPorItemPath", () => {
    const c = col([folder("Minha Pasta", [req("Cria Pedido")])]);
    const ip = itemPathDe("minha-pasta", "Cria Pedido");
    expect(acharRequestPorItemPath(c, ip)!.name).toBe("Cria Pedido");
  });
});
