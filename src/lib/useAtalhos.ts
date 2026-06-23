// F15 — Atalhos de teclado globais do app (nova aba, fechar, salvar, enviar).
//
// A parte PURA e `classificarAtalho`: mapeia um evento de teclado (so os campos
// relevantes) para uma acao logica, ou null se nao for um atalho conhecido. O
// hook `useAtalhos` so liga um listener no document e despacha os callbacks.
//
// A Integracao pluga este hook no App.tsx passando os handlers reais (que falam
// com tabsStore/requestStore). Mantemos o hook fino e a decisao testavel.

import { useEffect } from "react";

/** Acoes que um atalho pode disparar. */
export type AcaoAtalho = "novaAba" | "fecharAba" | "salvar" | "enviar";

/** Subset de KeyboardEvent que a classificacao precisa (facil de testar). */
export interface TeclaEvento {
  key: string;
  /** Ctrl (Windows/Linux). */
  ctrlKey: boolean;
  /** Cmd (macOS). Tratado como equivalente a Ctrl. */
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Classifica um evento de teclado numa acao de atalho, ou null. PURA.
 *
 * Mapa (Ctrl ou Cmd como modificador primario):
 *   Ctrl/Cmd + T       -> novaAba
 *   Ctrl/Cmd + W       -> fecharAba
 *   Ctrl/Cmd + S       -> salvar
 *   Ctrl/Cmd + Enter   -> enviar
 *
 * Regras: Alt nunca faz parte dos nossos atalhos (descarta p/ nao colidir com
 * acentuacao/menus). Shift e ignorado (nao exigido nem proibido) exceto que
 * NAO aceitamos combinacoes com Alt. A tecla e comparada case-insensitive.
 */
export function classificarAtalho(e: TeclaEvento): AcaoAtalho | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;

  // Enter nao tem variacao de caixa.
  if (e.key === "Enter") return "enviar";

  const k = e.key.toLowerCase();
  switch (k) {
    case "t":
      return "novaAba";
    case "w":
      return "fecharAba";
    case "s":
      return "salvar";
    default:
      return null;
  }
}

/** Callbacks que a Integracao fornece (handlers reais de cada acao). */
export interface HandlersAtalho {
  novaAba?: () => void;
  fecharAba?: () => void;
  salvar?: () => void;
  enviar?: () => void;
}

/**
 * Despacha uma acao classificada para o handler correspondente. Retorna true se
 * havia um handler (a UI deve entao chamar preventDefault). PURA. Exportada para
 * teste isolado do roteamento sem precisar montar o hook.
 */
export function despachar(
  acao: AcaoAtalho,
  handlers: HandlersAtalho,
): boolean {
  const fn = handlers[acao];
  if (!fn) return false;
  fn();
  return true;
}

/**
 * Hook que liga os atalhos globais ao `document`. A Integracao chama:
 *   useAtalhos({ novaAba, fecharAba, salvar, enviar })
 * Cada handler e opcional; ausentes deixam o atalho passar (sem preventDefault).
 * Re-liga quando `handlers` muda (use `useMemo`/refs estaveis no chamador para
 * evitar re-registro a cada render se desejar).
 */
export function useAtalhos(handlers: HandlersAtalho): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const acao = classificarAtalho(e);
      if (acao === null) return;
      const tratou = despachar(acao, handlers);
      if (tratou) {
        // Evita o comportamento default do navegador/webview (ex.: Ctrl+S
        // salvar pagina, Ctrl+W fechar janela do webview).
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}

export default useAtalhos;
