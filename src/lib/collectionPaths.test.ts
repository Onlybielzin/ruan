// Testes da LOGICA PURA da F2 (gerenciar colecoes): as duas funcoes puras
// exportadas de src/store/collectionsStore.ts:
//   - juntarCaminho(parent, nome): junta pai+nome tolerando barra final.
//   - slugFront(nome): espelho front do slug_seguro do backend (so para prever
//     o nome da pasta criada).
//
// Estas sao alvo de mutation testing: por isso cobrimos casos normais, limites e
// maliciosos com asserts exatos (nao "truthy"), pra matar o maximo de mutantes.
//
// O modulo collectionsStore importa APIs do Tauri (@tauri-apps/api/core e
// plugin-dialog) no topo. Mockamos ambas para que a importacao funcione sob
// jsdom sem um runtime Tauri real — as funcoes sob teste nao as usam.
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { juntarCaminho, slugFront } from "../store/collectionsStore";

describe("juntarCaminho", () => {
  it("junta pai e nome com uma barra", () => {
    expect(juntarCaminho("/home/u/colecoes", "minha-api")).toBe(
      "/home/u/colecoes/minha-api",
    );
  });

  it("tolera barra final no pai (nao duplica)", () => {
    expect(juntarCaminho("/home/u/colecoes/", "minha-api")).toBe(
      "/home/u/colecoes/minha-api",
    );
  });

  it("pai sem barra final tambem funciona", () => {
    expect(juntarCaminho("/a", "b")).toBe("/a/b");
  });

  it("apenas UMA barra final e removida (nao colapsa multiplas)", () => {
    // O codigo so apara um caractere final se for '/'. "/a//" vira "/a/" + "/b".
    expect(juntarCaminho("/a//", "b")).toBe("/a//b");
  });

  it("pai raiz '/' vira '' + nome -> caminho absoluto do nome", () => {
    // "/".slice(0,-1) === "" -> "" + "/" + "b" === "/b".
    expect(juntarCaminho("/", "b")).toBe("/b");
  });

  it("pai vazio produz /nome", () => {
    // "" nao termina com "/", entao base === "" -> "/b".
    expect(juntarCaminho("", "b")).toBe("/b");
  });

  it("nome vazio produz pai + barra", () => {
    expect(juntarCaminho("/a", "")).toBe("/a/");
  });

  it("preserva o nome exatamente (nao slugifica aqui)", () => {
    // juntarCaminho nao transforma o nome; quem slugifica e slugFront/o backend.
    expect(juntarCaminho("/a", "Nome Com Espaco")).toBe("/a/Nome Com Espaco");
  });

  it("nao altera componentes intermediarios do pai", () => {
    expect(juntarCaminho("/home/user name/dir.bak", "x")).toBe(
      "/home/user name/dir.bak/x",
    );
  });

  it("aceita caminhos no estilo Windows como string opaca", () => {
    // A funcao so olha o ultimo char; backslash nao e tratado como separador.
    expect(juntarCaminho("C:\\colecoes", "api")).toBe("C:\\colecoes/api");
  });
});

describe("slugFront", () => {
  it("minusculiza e troca espacos por hifen", () => {
    expect(slugFront("Minha API")).toBe("minha-api");
  });

  it("remove acentos (NFD + strip de diacriticos)", () => {
    expect(slugFront("Olá Mundo")).toBe("ola-mundo");
    expect(slugFront("résumé café")).toBe("resume-cafe");
    expect(slugFront("ÀÉÎÕÜ")).toBe("aeiou");
  });

  it("colapsa sequencias de nao-alfanumericos num unico hifen", () => {
    expect(slugFront("C++  &  Go")).toBe("c-go");
  });

  it("apara hifens das pontas", () => {
    expect(slugFront("---a---b---")).toBe("a-b");
    expect(slugFront("  espacos nas pontas  ")).toBe("espacos-nas-pontas");
  });

  it("preserva numeros", () => {
    expect(slugFront("123")).toBe("123");
    expect(slugFront("v2 api 3")).toBe("v2-api-3");
  });

  it("nome so de simbolos vira string vazia", () => {
    // Diferente do backend (que ERRA): aqui apenas retornamos "" pois e so um
    // espelho para prever o caminho. A validacao real e do Rust.
    expect(slugFront("!!!")).toBe("");
  });

  it("string vazia vira string vazia", () => {
    expect(slugFront("")).toBe("");
  });

  it("so espacos vira string vazia", () => {
    expect(slugFront("   ")).toBe("");
  });

  it("resultado contem apenas [a-z0-9-]", () => {
    const s = slugFront("Tudo: !@#$ Misturado_123 ÀÉÎ");
    expect(s).toMatch(/^[a-z0-9-]*$/);
    expect(s).toBe("tudo-misturado-123-aei");
  });

  it("nunca contem barra nem contrabarra (nao atravessa diretorios)", () => {
    const s = slugFront("a/b\\c");
    expect(s).not.toContain("/");
    expect(s).not.toContain("\\");
    expect(s).toBe("a-b-c");
  });

  it("componentes de traversal viram hifens (nao escapam)", () => {
    // O espelho front nao "erra", mas o resultado nunca tem '/' nem '..' utilizavel.
    expect(slugFront("..")).toBe("");
    expect(slugFront("../escapa")).toBe("escapa");
    expect(slugFront("/etc/passwd")).toBe("etc-passwd");
  });

  it("underscore nao e alfanumerico [a-z0-9] -> vira hifen", () => {
    // O regex e [^a-z0-9]+, entao '_' (apesar de ser \w) vira hifen.
    expect(slugFront("foo_bar")).toBe("foo-bar");
  });

  it("idempotente sobre um slug ja valido", () => {
    expect(slugFront("ja-e-um-slug")).toBe("ja-e-um-slug");
  });

  it("maiusculas acentuadas misturadas", () => {
    expect(slugFront("CAFÉ Com Leite")).toBe("cafe-com-leite");
  });

  it("hifen unico no meio e preservado", () => {
    expect(slugFront("a-b")).toBe("a-b");
  });
});
