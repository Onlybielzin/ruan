// F15 — Testes da logica PURA dos atalhos de teclado.
// Cobre: classificarAtalho (Ctrl/Cmd + T/W/S/Enter, Alt descarta, sem modificador
// descarta, case-insensitive, teclas desconhecidas) e despachar (chama handler,
// retorna true/false, so o handler alvo).

import { describe, it, expect, vi } from "vitest";
import {
  classificarAtalho,
  despachar,
  type TeclaEvento,
  type AcaoAtalho,
  type HandlersAtalho,
} from "./useAtalhos";

/** Monta um TeclaEvento com defaults sem modificadores. */
function ev(over: Partial<TeclaEvento>): TeclaEvento {
  return {
    key: over.key ?? "",
    ctrlKey: over.ctrlKey ?? false,
    metaKey: over.metaKey ?? false,
    shiftKey: over.shiftKey ?? false,
    altKey: over.altKey ?? false,
  };
}

describe("classificarAtalho", () => {
  it("Ctrl+T -> novaAba", () => {
    expect(classificarAtalho(ev({ key: "t", ctrlKey: true }))).toBe("novaAba");
  });

  it("Cmd+T -> novaAba (meta equivale a ctrl)", () => {
    expect(classificarAtalho(ev({ key: "t", metaKey: true }))).toBe("novaAba");
  });

  it("Ctrl+W -> fecharAba", () => {
    expect(classificarAtalho(ev({ key: "w", ctrlKey: true }))).toBe("fecharAba");
  });

  it("Ctrl+S -> salvar", () => {
    expect(classificarAtalho(ev({ key: "s", ctrlKey: true }))).toBe("salvar");
  });

  it("Ctrl+Enter -> enviar", () => {
    expect(classificarAtalho(ev({ key: "Enter", ctrlKey: true }))).toBe("enviar");
  });

  it("Cmd+Enter -> enviar", () => {
    expect(classificarAtalho(ev({ key: "Enter", metaKey: true }))).toBe("enviar");
  });

  it("case-insensitive: Ctrl+Shift+T (key 'T') ainda -> novaAba", () => {
    expect(
      classificarAtalho(ev({ key: "T", ctrlKey: true, shiftKey: true })),
    ).toBe("novaAba");
  });

  it("case-insensitive para W e S maiusculos", () => {
    expect(classificarAtalho(ev({ key: "W", ctrlKey: true }))).toBe("fecharAba");
    expect(classificarAtalho(ev({ key: "S", ctrlKey: true }))).toBe("salvar");
  });

  it("Alt descarta mesmo com Ctrl (PT-BR / acentuacao)", () => {
    expect(
      classificarAtalho(ev({ key: "t", ctrlKey: true, altKey: true })),
    ).toBeNull();
  });

  it("Alt descarta tambem para Enter", () => {
    expect(
      classificarAtalho(ev({ key: "Enter", ctrlKey: true, altKey: true })),
    ).toBeNull();
  });

  it("Alt sozinho (sem Ctrl) descarta", () => {
    expect(classificarAtalho(ev({ key: "t", altKey: true }))).toBeNull();
  });

  it("sem modificador primario: tecla solta -> null", () => {
    expect(classificarAtalho(ev({ key: "t" }))).toBeNull();
    expect(classificarAtalho(ev({ key: "Enter" }))).toBeNull();
  });

  it("Shift sozinho (sem Ctrl/Cmd) -> null", () => {
    expect(classificarAtalho(ev({ key: "t", shiftKey: true }))).toBeNull();
  });

  it("Ctrl + tecla desconhecida -> null", () => {
    expect(classificarAtalho(ev({ key: "q", ctrlKey: true }))).toBeNull();
    expect(classificarAtalho(ev({ key: "a", ctrlKey: true }))).toBeNull();
  });

  it("Enter sem caixa: 'enter' minusculo NAO casa (so 'Enter' exato)", () => {
    // a checagem de Enter e exata (e.key === 'Enter'); minusculo cai no switch
    // e nao casa nenhuma letra conhecida -> null.
    expect(classificarAtalho(ev({ key: "enter", ctrlKey: true }))).toBeNull();
  });

  it("Shift nao impede os atalhos validos", () => {
    expect(
      classificarAtalho(ev({ key: "s", ctrlKey: true, shiftKey: true })),
    ).toBe("salvar");
  });
});

describe("despachar", () => {
  it("chama o handler da acao e retorna true", () => {
    const novaAba = vi.fn();
    const ok = despachar("novaAba", { novaAba });
    expect(ok).toBe(true);
    expect(novaAba).toHaveBeenCalledTimes(1);
  });

  it("retorna false e nao chama nada se o handler estiver ausente", () => {
    const handlers: HandlersAtalho = {};
    expect(despachar("salvar", handlers)).toBe(false);
  });

  it("so chama o handler da acao certa, nao os demais", () => {
    const novaAba = vi.fn();
    const fecharAba = vi.fn();
    const salvar = vi.fn();
    const enviar = vi.fn();
    despachar("fecharAba", { novaAba, fecharAba, salvar, enviar });
    expect(fecharAba).toHaveBeenCalledTimes(1);
    expect(novaAba).not.toHaveBeenCalled();
    expect(salvar).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it("roteia cada acao para o seu handler", () => {
    const acoes: AcaoAtalho[] = ["novaAba", "fecharAba", "salvar", "enviar"];
    for (const acao of acoes) {
      const fn = vi.fn();
      const ok = despachar(acao, { [acao]: fn });
      expect(ok).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});
