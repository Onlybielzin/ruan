// Testes da LOGICA PURA da F14 (cookie jar) — front.
// Alvo de mutation: src/store/cookiesStore.ts (funcoes puras hostDeUrl,
// filtrarCookies, agruparPorDominio) + logica pura dos wrappers IPC e do store
// (registrarDominio dedupe, mapeamento de args dos invoke).
//
// O modulo importa @tauri-apps/api/core no topo; mockamos `invoke` para o
// import resolver e para inspecionar o mapeamento de argumentos (logica pura
// "filtro ?? null", "dominio ?? null", etc.).

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  hostDeUrl,
  filtrarCookies,
  agruparPorDominio,
  ipcListCookies,
  ipcClearCookies,
  ipcSetCookiesEnabled,
  ipcCookiesEnabled,
  useCookiesStore,
  type CookieInfo,
} from "./cookiesStore";

function ck(over: Partial<CookieInfo> = {}): CookieInfo {
  return {
    dominio: "x.test",
    nome: "sid",
    valor: "abc",
    path: "/",
    secure: false,
    ...over,
  };
}

// Estado inicial do store para isolar cada teste (Zustand e singleton).
const estadoInicial = useCookiesStore.getState();
beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  useCookiesStore.setState(
    {
      cookies: [],
      enabled: true,
      loading: false,
      error: null,
      filtro: "",
      dominiosVistos: [],
    },
    false,
  );
});

// ---------------------------------------------------------------------------
// hostDeUrl
// ---------------------------------------------------------------------------

describe("hostDeUrl", () => {
  it("extrai host de URL completa https", () => {
    expect(hostDeUrl("https://api.x.test/foo?q=1")).toBe("api.x.test");
  });

  it("extrai host de URL http", () => {
    expect(hostDeUrl("http://x.test/")).toBe("x.test");
  });

  it("inclui porta no host", () => {
    expect(hostDeUrl("http://localhost:8080/api")).toBe("localhost:8080");
  });

  it("assume https quando falta protocolo", () => {
    expect(hostDeUrl("api.x.test/foo")).toBe("api.x.test");
  });

  it("assume https para host nu", () => {
    expect(hostDeUrl("example.com")).toBe("example.com");
  });

  it("faz trim antes de parsear", () => {
    expect(hostDeUrl("   https://x.test/   ")).toBe("x.test");
  });

  it("string vazia vira vazio", () => {
    expect(hostDeUrl("")).toBe("");
  });

  it("so espacos vira vazio", () => {
    expect(hostDeUrl("   ")).toBe("");
  });

  it("nullish vira vazio (?? guarda)", () => {
    // @ts-expect-error testando robustez a undefined
    expect(hostDeUrl(undefined)).toBe("");
    // @ts-expect-error testando robustez a null
    expect(hostDeUrl(null)).toBe("");
  });

  it("entrada nao-parseavel mesmo com prefixo vira vazio", () => {
    // Espacos internos quebram os dois new URL().
    expect(hostDeUrl("ht tp://%%% nada")).toBe("");
  });

  it("nao confunde path com host quando ja tem protocolo", () => {
    // Com protocolo valido o primeiro new URL() vence; nao reprefixa.
    expect(hostDeUrl("https://real.test/https://fake.test")).toBe("real.test");
  });
});

// ---------------------------------------------------------------------------
// filtrarCookies
// ---------------------------------------------------------------------------

describe("filtrarCookies", () => {
  const cookies = [
    ck({ dominio: "api.x.test", nome: "a" }),
    ck({ dominio: "www.y.test", nome: "b" }),
    ck({ dominio: "x.test", nome: "c" }),
  ];

  it("filtro vazio devolve a lista inteira (mesma referencia)", () => {
    expect(filtrarCookies(cookies, "")).toBe(cookies);
  });

  it("filtro undefined devolve a lista inteira", () => {
    expect(filtrarCookies(cookies)).toBe(cookies);
  });

  it("filtro so de espacos devolve a lista inteira", () => {
    expect(filtrarCookies(cookies, "   ")).toBe(cookies);
  });

  it("filtra por substring do dominio", () => {
    const r = filtrarCookies(cookies, "x.test");
    expect(r.map((c) => c.nome)).toEqual(["a", "c"]);
  });

  it("filtro case-insensitive", () => {
    const r = filtrarCookies(cookies, "X.TEST");
    expect(r.map((c) => c.nome)).toEqual(["a", "c"]);
  });

  it("trim no filtro", () => {
    const r = filtrarCookies(cookies, "  y.test  ");
    expect(r.map((c) => c.nome)).toEqual(["b"]);
  });

  it("sem match devolve vazio", () => {
    expect(filtrarCookies(cookies, "zzz")).toEqual([]);
  });

  it("nao muta a lista original", () => {
    const copia = [...cookies];
    filtrarCookies(cookies, "x.test");
    expect(cookies).toEqual(copia);
  });
});

// ---------------------------------------------------------------------------
// agruparPorDominio
// ---------------------------------------------------------------------------

describe("agruparPorDominio", () => {
  it("lista vazia vira grupos vazios", () => {
    expect(agruparPorDominio([])).toEqual([]);
  });

  it("agrupa cookies do mesmo dominio", () => {
    const r = agruparPorDominio([
      ck({ dominio: "x.test", nome: "a" }),
      ck({ dominio: "x.test", nome: "b" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].dominio).toBe("x.test");
    expect(r[0].cookies.map((c) => c.nome)).toEqual(["a", "b"]);
  });

  it("preserva ordem de primeira aparicao do dominio", () => {
    const r = agruparPorDominio([
      ck({ dominio: "b.test", nome: "1" }),
      ck({ dominio: "a.test", nome: "2" }),
      ck({ dominio: "b.test", nome: "3" }),
    ]);
    expect(r.map((g) => g.dominio)).toEqual(["b.test", "a.test"]);
    expect(r[0].cookies.map((c) => c.nome)).toEqual(["1", "3"]);
    expect(r[1].cookies.map((c) => c.nome)).toEqual(["2"]);
  });

  it("dominios distintos viram grupos distintos", () => {
    const r = agruparPorDominio([
      ck({ dominio: "a.test" }),
      ck({ dominio: "b.test" }),
      ck({ dominio: "c.test" }),
    ]);
    expect(r.map((g) => g.dominio)).toEqual(["a.test", "b.test", "c.test"]);
    expect(r.every((g) => g.cookies.length === 1)).toBe(true);
  });

  it("preserva cada cookie na ordem dentro do grupo", () => {
    const c1 = ck({ dominio: "x.test", nome: "primeiro" });
    const c2 = ck({ dominio: "x.test", nome: "segundo" });
    const r = agruparPorDominio([c1, c2]);
    expect(r[0].cookies[0]).toBe(c1);
    expect(r[0].cookies[1]).toBe(c2);
  });
});

// ---------------------------------------------------------------------------
// Wrappers IPC — mapeamento de argumentos (logica pura "?? null")
// ---------------------------------------------------------------------------

describe("ipcListCookies", () => {
  it("invoca list_cookies com dominios e filtro", async () => {
    invokeMock.mockResolvedValue([ck()]);
    const r = await ipcListCookies(["x.test"], "abc");
    expect(invokeMock).toHaveBeenCalledWith("list_cookies", {
      dominios: ["x.test"],
      filtro: "abc",
    });
    expect(r).toEqual([ck()]);
  });

  it("filtro ausente vira null (nao undefined)", async () => {
    invokeMock.mockResolvedValue([]);
    await ipcListCookies(["x.test"]);
    expect(invokeMock).toHaveBeenCalledWith("list_cookies", {
      dominios: ["x.test"],
      filtro: null,
    });
  });
});

describe("ipcClearCookies", () => {
  it("invoca clear_cookies com dominio", async () => {
    invokeMock.mockResolvedValue(false);
    const r = await ipcClearCookies("x.test");
    expect(invokeMock).toHaveBeenCalledWith("clear_cookies", {
      dominio: "x.test",
    });
    expect(r).toBe(false);
  });

  it("dominio ausente vira null", async () => {
    invokeMock.mockResolvedValue(true);
    const r = await ipcClearCookies();
    expect(invokeMock).toHaveBeenCalledWith("clear_cookies", {
      dominio: null,
    });
    expect(r).toBe(true);
  });
});

describe("ipcSetCookiesEnabled / ipcCookiesEnabled", () => {
  it("set passa o flag on", async () => {
    invokeMock.mockResolvedValue(true);
    const r = await ipcSetCookiesEnabled(true);
    expect(invokeMock).toHaveBeenCalledWith("set_cookies_enabled", { on: true });
    expect(r).toBe(true);
  });

  it("set passa o flag off", async () => {
    invokeMock.mockResolvedValue(false);
    await ipcSetCookiesEnabled(false);
    expect(invokeMock).toHaveBeenCalledWith("set_cookies_enabled", {
      on: false,
    });
  });

  it("cookies_enabled le o estado sem args", async () => {
    invokeMock.mockResolvedValue(true);
    const r = await ipcCookiesEnabled();
    expect(invokeMock).toHaveBeenCalledWith("cookies_enabled");
    expect(r).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Store — logica pura de registrarDominio / setFiltro
// ---------------------------------------------------------------------------

describe("store.registrarDominio (dedupe puro)", () => {
  it("adiciona um dominio novo", () => {
    useCookiesStore.getState().registrarDominio("x.test");
    expect(useCookiesStore.getState().dominiosVistos).toEqual(["x.test"]);
  });

  it("nao duplica dominio ja visto (mantem a mesma referencia de state)", () => {
    const s = useCookiesStore.getState();
    s.registrarDominio("x.test");
    const antes = useCookiesStore.getState().dominiosVistos;
    s.registrarDominio("x.test");
    const depois = useCookiesStore.getState().dominiosVistos;
    expect(depois).toEqual(["x.test"]);
    // dedupe retorna o mesmo state -> mesma referencia do array
    expect(depois).toBe(antes);
  });

  it("acumula dominios distintos em ordem", () => {
    const s = useCookiesStore.getState();
    s.registrarDominio("a.test");
    s.registrarDominio("b.test");
    expect(useCookiesStore.getState().dominiosVistos).toEqual([
      "a.test",
      "b.test",
    ]);
  });

  it("faz trim e ignora host vazio/whitespace", () => {
    const s = useCookiesStore.getState();
    s.registrarDominio("  x.test  ");
    s.registrarDominio("");
    s.registrarDominio("   ");
    expect(useCookiesStore.getState().dominiosVistos).toEqual(["x.test"]);
  });

  it("ignora nullish sem quebrar", () => {
    const s = useCookiesStore.getState();
    // @ts-expect-error robustez a undefined
    s.registrarDominio(undefined);
    expect(useCookiesStore.getState().dominiosVistos).toEqual([]);
  });
});

describe("store.setFiltro", () => {
  it("grava o filtro", () => {
    useCookiesStore.getState().setFiltro("abc");
    expect(useCookiesStore.getState().filtro).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// Store — fluxos assincronos (recarregar / setEnabled / limpar / erros)
// ---------------------------------------------------------------------------

describe("store.recarregar", () => {
  it("carrega cookies dos dominios vistos e limpa loading", async () => {
    useCookiesStore.getState().registrarDominio("x.test");
    invokeMock.mockResolvedValue([ck()]);
    await useCookiesStore.getState().recarregar();
    expect(invokeMock).toHaveBeenCalledWith("list_cookies", {
      dominios: ["x.test"],
      filtro: null,
    });
    const st = useCookiesStore.getState();
    expect(st.cookies).toEqual([ck()]);
    expect(st.loading).toBe(false);
    expect(st.error).toBeNull();
  });

  it("erro de IPC vira mensagem e desliga loading", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    await useCookiesStore.getState().recarregar();
    const st = useCookiesStore.getState();
    expect(st.loading).toBe(false);
    expect(st.error).toBe("boom");
  });

  it("erro string e propagado como mensagem", async () => {
    invokeMock.mockRejectedValue("falha-ipc");
    await useCookiesStore.getState().recarregar();
    expect(useCookiesStore.getState().error).toBe("falha-ipc");
  });
});

describe("store.setEnabled", () => {
  it("atualiza enabled com o retorno do backend", async () => {
    invokeMock.mockResolvedValue(false);
    await useCookiesStore.getState().setEnabled(false);
    const st = useCookiesStore.getState();
    expect(st.enabled).toBe(false);
    expect(st.loading).toBe(false);
  });

  it("erro mantem estado e registra mensagem", async () => {
    invokeMock.mockRejectedValue(new Error("x"));
    await useCookiesStore.getState().setEnabled(true);
    const st = useCookiesStore.getState();
    expect(st.error).toBe("x");
    expect(st.loading).toBe(false);
  });
});

describe("store.carregarEnabled", () => {
  it("le o toggle do backend", async () => {
    invokeMock.mockResolvedValue(false);
    await useCookiesStore.getState().carregarEnabled();
    expect(useCookiesStore.getState().enabled).toBe(false);
  });

  it("erro nao quebra, registra mensagem", async () => {
    invokeMock.mockRejectedValue(new Error("falhou"));
    await useCookiesStore.getState().carregarEnabled();
    expect(useCookiesStore.getState().error).toBe("falhou");
  });
});

describe("store.limpar", () => {
  it("limpa e re-lista do backend", async () => {
    useCookiesStore.getState().registrarDominio("x.test");
    // 1a chamada: clear_cookies; 2a: list_cookies
    invokeMock.mockResolvedValueOnce(true).mockResolvedValueOnce([]);
    await useCookiesStore.getState().limpar();
    expect(invokeMock).toHaveBeenNthCalledWith(1, "clear_cookies", {
      dominio: null,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_cookies", {
      dominios: ["x.test"],
      filtro: null,
    });
    const st = useCookiesStore.getState();
    expect(st.cookies).toEqual([]);
    expect(st.loading).toBe(false);
  });

  it("repassa dominio ao clear", async () => {
    invokeMock.mockResolvedValueOnce(false).mockResolvedValueOnce([]);
    await useCookiesStore.getState().limpar("x.test");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "clear_cookies", {
      dominio: "x.test",
    });
  });

  it("erro no clear desliga loading e registra mensagem", async () => {
    invokeMock.mockRejectedValue(new Error("nope"));
    await useCookiesStore.getState().limpar();
    const st = useCookiesStore.getState();
    expect(st.error).toBe("nope");
    expect(st.loading).toBe(false);
  });
});

// Restaura o estado original do store apos a suite.
afterAll(() => {
  useCookiesStore.setState(estadoInicial, true);
});
