// Testes da logica PURA da arvore/sidebar (F3). Alvo de mutation testing.
// Cobre ordenacao, reordenacao (DnD), geracao de nomes unicos, validacao de
// nomes (incluindo casos maliciosos/path-traversal) e badges de metodo.
import { describe, it, expect } from "vitest";
import type { TreeItem, RequestItem, Folder } from "./types";
import {
  kindOf,
  ordenarItems,
  compararNome,
  reordenar,
  clamp,
  seqParaPosicao,
  seqsSequenciais,
  updatesNecessarios,
  nomeCopia,
  nomeNovoUnico,
  validarNomeFront,
  ehAbsoluto,
  corMetodo,
  rotuloMetodo,
} from "./tree";

// ----------------------------------------------------------------------------
// Helpers para construir TreeItems concisos
// ----------------------------------------------------------------------------
function req(name: string, seq: number): TreeItem {
  return {
    type: "request",
    name,
    seq,
    method: "GET",
    url: "",
    headers: [],
    params: [],
    body: { mode: "none" },
    auth: { mode: "none" },
    scripts: { pre: "", post: "" },
    tests: "",
    docs: "",
  } as { type: "request" } & RequestItem;
}

function folder(name: string, seq: number, items: TreeItem[] = []): TreeItem {
  return {
    type: "folder",
    name,
    seq,
    items,
  } as { type: "folder" } & Folder;
}

/** Extrai nomes na ordem para asserts compactos. */
const nomes = (items: TreeItem[]) => items.map((i) => i.name);

// ----------------------------------------------------------------------------
// kindOf
// ----------------------------------------------------------------------------
describe("kindOf", () => {
  it("retorna 'folder' para pasta", () => {
    expect(kindOf(folder("a", 0))).toBe("folder");
  });
  it("retorna 'request' para request", () => {
    expect(kindOf(req("a", 0))).toBe("request");
  });
});

// ----------------------------------------------------------------------------
// compararNome
// ----------------------------------------------------------------------------
describe("compararNome", () => {
  it("a < b retorna -1", () => {
    expect(compararNome("a", "b")).toBe(-1);
  });
  it("a > b retorna 1", () => {
    expect(compararNome("b", "a")).toBe(1);
  });
  it("iguais retorna 0", () => {
    expect(compararNome("x", "x")).toBe(0);
  });
  it("case-sensitive: maiusculas vem antes (ASCII)", () => {
    // 'Z' (90) < 'a' (97)
    expect(compararNome("Z", "a")).toBe(-1);
  });
  it("vazio < nao-vazio", () => {
    expect(compararNome("", "a")).toBe(-1);
  });
  it("prefixo < string mais longa", () => {
    expect(compararNome("ab", "abc")).toBe(-1);
  });
});

// ----------------------------------------------------------------------------
// ordenarItems
// ----------------------------------------------------------------------------
describe("ordenarItems", () => {
  it("ordena por seq crescente", () => {
    const out = ordenarItems([req("c", 2), req("a", 0), req("b", 1)]);
    expect(nomes(out)).toEqual(["a", "b", "c"]);
  });

  it("desempata por nome quando seq igual", () => {
    const out = ordenarItems([req("c", 0), req("a", 0), req("b", 0)]);
    expect(nomes(out)).toEqual(["a", "b", "c"]);
  });

  it("seq tem prioridade sobre nome", () => {
    // 'z' com seq 0 vem antes de 'a' com seq 1
    const out = ordenarItems([req("a", 1), req("z", 0)]);
    expect(nomes(out)).toEqual(["z", "a"]);
  });

  it("nao muta a entrada", () => {
    const entrada = [req("b", 1), req("a", 0)];
    const copia = [...entrada];
    ordenarItems(entrada);
    expect(nomes(entrada)).toEqual(nomes(copia));
  });

  it("retorna nova referencia de array", () => {
    const entrada = [req("a", 0)];
    expect(ordenarItems(entrada)).not.toBe(entrada);
  });

  it("lista vazia retorna vazio", () => {
    expect(ordenarItems([])).toEqual([]);
  });

  it("mistura pastas e requests por seq/nome (sem separar tipos)", () => {
    const out = ordenarItems([req("req", 1), folder("dir", 0)]);
    expect(nomes(out)).toEqual(["dir", "req"]);
  });

  it("seq negativo vem antes de positivo", () => {
    const out = ordenarItems([req("a", 1), req("b", -1)]);
    expect(nomes(out)).toEqual(["b", "a"]);
  });
});

// ----------------------------------------------------------------------------
// clamp
// ----------------------------------------------------------------------------
describe("clamp", () => {
  it("valor dentro do intervalo nao muda", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("abaixo do minimo retorna minimo", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it("acima do maximo retorna maximo", () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it("igual ao minimo retorna minimo (limite)", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });
  it("igual ao maximo retorna maximo (limite)", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

// ----------------------------------------------------------------------------
// reordenar (DnD)
// ----------------------------------------------------------------------------
describe("reordenar", () => {
  const base = () => [req("a", 0), req("b", 1), req("c", 2), req("d", 3)];

  it("mover do inicio para o fim", () => {
    const out = reordenar(base(), 0, 4);
    expect(nomes(out)).toEqual(["b", "c", "d", "a"]);
  });

  it("mover do fim para o inicio", () => {
    const out = reordenar(base(), 3, 0);
    expect(nomes(out)).toEqual(["d", "a", "b", "c"]);
  });

  it("mover para frente: solta antes do indice 'to'", () => {
    // mover 'a' (0) para antes do indice 2 -> a fica entre b e c
    const out = reordenar(base(), 0, 2);
    expect(nomes(out)).toEqual(["b", "a", "c", "d"]);
  });

  it("mover para tras", () => {
    // mover 'd' (3) para antes do indice 1
    const out = reordenar(base(), 3, 1);
    expect(nomes(out)).toEqual(["a", "d", "b", "c"]);
  });

  it("from == to nao altera a ordem", () => {
    const out = reordenar(base(), 2, 2);
    expect(nomes(out)).toEqual(["a", "b", "c", "d"]);
  });

  it("to == from+1 (mesmo lugar, soltar logo depois) nao move", () => {
    // soltar 'b' (1) antes do indice 2 -> apos remover, destino 2->1, fica no lugar
    const out = reordenar(base(), 1, 2);
    expect(nomes(out)).toEqual(["a", "b", "c", "d"]);
  });

  it("indice 'from' fora do intervalo e clampeado para o ultimo", () => {
    const out = reordenar(base(), 99, 0);
    expect(nomes(out)).toEqual(["d", "a", "b", "c"]);
  });

  it("indice 'from' negativo e clampeado para 0", () => {
    const out = reordenar(base(), -5, 4);
    expect(nomes(out)).toEqual(["b", "c", "d", "a"]);
  });

  it("indice 'to' acima do tamanho e clampeado para n (fim)", () => {
    const out = reordenar(base(), 0, 999);
    expect(nomes(out)).toEqual(["b", "c", "d", "a"]);
  });

  it("indice 'to' negativo e clampeado para 0 (inicio)", () => {
    const out = reordenar(base(), 3, -10);
    expect(nomes(out)).toEqual(["d", "a", "b", "c"]);
  });

  it("lista vazia retorna vazio", () => {
    expect(reordenar([], 0, 0)).toEqual([]);
  });

  it("lista de um elemento permanece igual", () => {
    const out = reordenar([req("solo", 0)], 0, 0);
    expect(nomes(out)).toEqual(["solo"]);
  });

  it("nao muta a entrada", () => {
    const entrada = base();
    const antes = nomes(entrada);
    reordenar(entrada, 0, 3);
    expect(nomes(entrada)).toEqual(antes);
  });

  it("retorna nova referencia", () => {
    const entrada = base();
    expect(reordenar(entrada, 0, 0)).not.toBe(entrada);
  });
});

// ----------------------------------------------------------------------------
// seqParaPosicao
// ----------------------------------------------------------------------------
describe("seqParaPosicao", () => {
  it("indice 0 -> 0", () => {
    expect(seqParaPosicao(0)).toBe(0);
  });
  it("indice positivo -> mesmo valor", () => {
    expect(seqParaPosicao(7)).toBe(7);
  });
  it("indice negativo -> 0 (nao negativo)", () => {
    expect(seqParaPosicao(-3)).toBe(0);
  });
  it("trunca fracionario", () => {
    expect(seqParaPosicao(3.9)).toBe(3);
  });
  it("trunca em direcao a zero (nao floor) para negativo", () => {
    // Math.trunc(-0.5) = -0, depois max(0,-0) = 0
    expect(seqParaPosicao(-0.5)).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// seqsSequenciais
// ----------------------------------------------------------------------------
describe("seqsSequenciais", () => {
  it("reescreve seqs como 0..n-1 preservando ordem", () => {
    const out = seqsSequenciais([req("a", 5), req("b", 9), req("c", 2)]);
    expect(out).toEqual([
      { name: "a", kind: "request", seq: 0, seqAntigo: 5 },
      { name: "b", kind: "request", seq: 1, seqAntigo: 9 },
      { name: "c", kind: "request", seq: 2, seqAntigo: 2 },
    ]);
  });

  it("inclui kind correto por item", () => {
    const out = seqsSequenciais([folder("dir", 3), req("r", 1)]);
    expect(out[0].kind).toBe("folder");
    expect(out[1].kind).toBe("request");
  });

  it("lista vazia -> vazio", () => {
    expect(seqsSequenciais([])).toEqual([]);
  });

  it("seqAntigo reflete o seq original do item", () => {
    const out = seqsSequenciais([req("x", 42)]);
    expect(out[0].seqAntigo).toBe(42);
    expect(out[0].seq).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// updatesNecessarios
// ----------------------------------------------------------------------------
describe("updatesNecessarios", () => {
  it("retorna so os itens cujo seq mudou", () => {
    // a: 5->0 (muda), b: 1->1 (igual), c: 9->2 (muda)
    const out = updatesNecessarios([req("a", 5), req("b", 1), req("c", 9)]);
    expect(out.map((u) => u.name)).toEqual(["a", "c"]);
  });

  it("ja sequencial -> nenhum update", () => {
    const out = updatesNecessarios([req("a", 0), req("b", 1), req("c", 2)]);
    expect(out).toEqual([]);
  });

  it("todos mudam quando seq todos errados", () => {
    const out = updatesNecessarios([req("a", 10), req("b", 11)]);
    expect(out.length).toBe(2);
  });

  it("lista vazia -> vazio", () => {
    expect(updatesNecessarios([])).toEqual([]);
  });

  it("item na posicao certa por acaso nao gera update", () => {
    // b ja esta com seq 1 na posicao 1
    const out = updatesNecessarios([req("a", 3), req("b", 1)]);
    expect(out.map((u) => u.name)).toEqual(["a"]);
  });
});

// ----------------------------------------------------------------------------
// nomeCopia
// ----------------------------------------------------------------------------
describe("nomeCopia", () => {
  it("sem colisao retorna '<base> copia'", () => {
    expect(nomeCopia("Login", [])).toBe("Login copia");
  });

  it("'<base> copia' existente -> '<base> copia 2'", () => {
    expect(nomeCopia("Login", ["Login copia"])).toBe("Login copia 2");
  });

  it("incrementa ate achar livre", () => {
    expect(
      nomeCopia("Login", ["Login copia", "Login copia 2", "Login copia 3"]),
    ).toBe("Login copia 4");
  });

  it("ignora outros nomes nao relacionados", () => {
    expect(nomeCopia("X", ["Y copia", "Z copia 2"])).toBe("X copia");
  });

  it("case-sensitive: 'login copia' nao colide com 'Login copia'", () => {
    expect(nomeCopia("Login", ["login copia"])).toBe("Login copia");
  });

  it("buracos na sequencia: pega o primeiro livre apos colisao continua", () => {
    // 'copia' e 'copia 2' ocupados, 'copia 3' livre (4 existe mas nao chegamos)
    expect(nomeCopia("A", ["A copia", "A copia 2", "A copia 4"])).toBe(
      "A copia 3",
    );
  });

  it("original com espacos preservado", () => {
    expect(nomeCopia("Get User", [])).toBe("Get User copia");
  });
});

// ----------------------------------------------------------------------------
// nomeNovoUnico
// ----------------------------------------------------------------------------
describe("nomeNovoUnico", () => {
  it("sem colisao retorna o prefixo", () => {
    expect(nomeNovoUnico("Nova pasta", [])).toBe("Nova pasta");
  });

  it("prefixo existente -> '<prefixo> 2'", () => {
    expect(nomeNovoUnico("Nova pasta", ["Nova pasta"])).toBe("Nova pasta 2");
  });

  it("incrementa pulando ocupados", () => {
    expect(
      nomeNovoUnico("Nova pasta", ["Nova pasta", "Nova pasta 2"]),
    ).toBe("Nova pasta 3");
  });

  it("comeca em 2 (nunca usa sufixo 1)", () => {
    const out = nomeNovoUnico("P", ["P"]);
    expect(out).toBe("P 2");
    expect(out).not.toBe("P 1");
  });

  it("buraco na sequencia: pega o primeiro livre", () => {
    expect(nomeNovoUnico("P", ["P", "P 3"])).toBe("P 2");
  });

  it("nomes nao relacionados ignorados", () => {
    expect(nomeNovoUnico("Foo", ["Bar", "Baz 2"])).toBe("Foo");
  });
});

// ----------------------------------------------------------------------------
// ehAbsoluto
// ----------------------------------------------------------------------------
describe("ehAbsoluto", () => {
  it("string vazia nao e absoluta", () => {
    expect(ehAbsoluto("")).toBe(false);
  });
  it("prefixo '/' e absoluto", () => {
    expect(ehAbsoluto("/etc/passwd")).toBe(true);
  });
  it("prefixo '\\' e absoluto", () => {
    expect(ehAbsoluto("\\windows")).toBe(true);
  });
  it("drive letter maiuscula 'C:' e absoluto", () => {
    expect(ehAbsoluto("C:\\temp")).toBe(true);
  });
  it("drive letter minuscula 'd:' e absoluto", () => {
    expect(ehAbsoluto("d:/data")).toBe(true);
  });
  it("nome relativo comum nao e absoluto", () => {
    expect(ehAbsoluto("minha-request")).toBe(false);
  });
  it("letra + ':' + resto e tratado como drive letter (espelha o Rust)", () => {
    // eh_absoluto so olha [0]=letra e [1]=':'; o resto e ignorado.
    // 'a:b' bate o padrao de drive letter -> true (igual ao backend).
    expect(ehAbsoluto("a:b")).toBe(true);
  });
  it("digito seguido de ':' nao e drive letter", () => {
    expect(ehAbsoluto("1:foo")).toBe(false);
  });
  it("uma so letra (sem ':') nao e absoluto", () => {
    expect(ehAbsoluto("C")).toBe(false);
  });
  it("letra seguida de ':' sem mais nada AINDA e absoluto (len>=2)", () => {
    expect(ehAbsoluto("C:")).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// validarNomeFront (inclui casos maliciosos)
// ----------------------------------------------------------------------------
describe("validarNomeFront", () => {
  it("nome valido retorna null", () => {
    expect(validarNomeFront("Login")).toBeNull();
  });

  it("nome com espacos validos retorna null", () => {
    expect(validarNomeFront("Get User Profile")).toBeNull();
  });

  it("vazio retorna erro", () => {
    expect(validarNomeFront("")).toBe("Nome nao pode ser vazio");
  });

  it("so espacos (trim vazio) retorna erro de vazio", () => {
    expect(validarNomeFront("   ")).toBe("Nome nao pode ser vazio");
  });

  it("'.' retorna erro", () => {
    expect(validarNomeFront(".")).toBe("Nome invalido");
  });

  it("'..' retorna erro (traversal)", () => {
    expect(validarNomeFront("..")).toBe("Nome invalido");
  });

  it("'.' com espacos ao redor ainda e invalido (trim antes)", () => {
    expect(validarNomeFront("  ..  ")).toBe("Nome invalido");
  });

  it("contem '/' retorna erro de barras", () => {
    expect(validarNomeFront("a/b")).toBe("Nome nao pode conter barras");
  });

  it("contem '\\' retorna erro de barras", () => {
    expect(validarNomeFront("a\\b")).toBe("Nome nao pode conter barras");
  });

  it("path traversal '../etc' rejeitado (por barra)", () => {
    expect(validarNomeFront("../etc")).toBe("Nome nao pode conter barras");
  });

  it("contem NUL retorna erro", () => {
    expect(validarNomeFront("a\0b")).toBe("Nome invalido");
  });

  it("caminho absoluto unix rejeitado", () => {
    // '/etc' contem barra -> a checagem de barra dispara primeiro
    expect(validarNomeFront("/etc")).toBe("Nome nao pode conter barras");
  });

  it("drive letter absoluto sem barra rejeitado como absoluto", () => {
    expect(validarNomeFront("C:nome")).toBe(
      "Nome nao pode ser um caminho absoluto",
    );
  });

  it("nome com ponto interno (nao . nem ..) e valido", () => {
    expect(validarNomeFront("arquivo.json")).toBeNull();
  });

  it("nome com hifen e numeros e valido", () => {
    expect(validarNomeFront("req-123")).toBeNull();
  });

  it("checa barra no nome ORIGINAL, nao no trim (barra com espaco ao redor)", () => {
    expect(validarNomeFront("  a/b  ")).toBe("Nome nao pode conter barras");
  });
});

// ----------------------------------------------------------------------------
// corMetodo
// ----------------------------------------------------------------------------
describe("corMetodo", () => {
  it("GET teal", () => {
    expect(corMetodo("GET")).toBe("#4ec9b0");
  });
  it("POST ambar", () => {
    expect(corMetodo("POST")).toBe("#dcb67a");
  });
  it("PUT azul", () => {
    expect(corMetodo("PUT")).toBe("#569cd6");
  });
  it("PATCH roxo", () => {
    expect(corMetodo("PATCH")).toBe("#c586c0");
  });
  it("DELETE vermelho", () => {
    expect(corMetodo("DELETE")).toBe("#d16969");
  });
  it("HEAD cinza", () => {
    expect(corMetodo("HEAD")).toBe("#808080");
  });
  it("OPTIONS cinza", () => {
    expect(corMetodo("OPTIONS")).toBe("#808080");
  });
  it("metodo desconhecido -> cinza default", () => {
    expect(corMetodo("TRACE")).toBe("#808080");
  });
  it("case-insensitive: minusculas mapeiam igual", () => {
    expect(corMetodo("get")).toBe("#4ec9b0");
  });
  it("case-misto mapeia igual", () => {
    expect(corMetodo("PoSt")).toBe("#dcb67a");
  });
  it("string vazia -> cinza default", () => {
    expect(corMetodo("")).toBe("#808080");
  });
});

// ----------------------------------------------------------------------------
// rotuloMetodo
// ----------------------------------------------------------------------------
describe("rotuloMetodo", () => {
  it("GET inteiro (<=4)", () => {
    expect(rotuloMetodo("GET")).toBe("GET");
  });
  it("POST inteiro (exatamente 4)", () => {
    expect(rotuloMetodo("POST")).toBe("POST");
  });
  it("DELETE truncado para 4 chars", () => {
    expect(rotuloMetodo("DELETE")).toBe("DELE");
  });
  it("OPTIONS truncado para 4 chars", () => {
    expect(rotuloMetodo("OPTIONS")).toBe("OPTI");
  });
  it("converte para maiusculas", () => {
    expect(rotuloMetodo("get")).toBe("GET");
  });
  it("minusculo longo: maiusculiza e trunca", () => {
    expect(rotuloMetodo("delete")).toBe("DELE");
  });
  it("string vazia -> vazia", () => {
    expect(rotuloMetodo("")).toBe("");
  });
  it("metodo custom de 5 chars truncado", () => {
    expect(rotuloMetodo("QUERY")).toBe("QUER");
  });
});
