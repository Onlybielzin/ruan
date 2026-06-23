import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import CollectionToolbar from "./components/CollectionToolbar";
import Sidebar from "./components/Sidebar";
import RequestBuilder from "./components/RequestBuilder";
import QueryParams from "./components/QueryParams";
import Headers from "./components/Headers";
import BodyEditor from "./components/BodyEditor";
import AuthTab from "./components/AuthTab";
import ResponseViewer from "./components/ResponseViewer";
import EnvSelector from "./components/EnvSelector";
import EnvEditor from "./components/EnvEditor";
import Tabs from "./components/Tabs";
import ScriptEditor from "./components/ScriptEditor";
import TestsPanel from "./components/TestsPanel";
import ScriptConsole from "./components/ScriptConsole";
import CookiesPanel from "./components/CookiesPanel";
import HistoryPanel from "./components/HistoryPanel";

import { useCollectionsStore } from "./store/collectionsStore";
import { useRequestStore } from "./store/requestStore";
import { useTabsStore } from "./store/tabsStore";
import { useCookiesStore, hostDeUrl } from "./store/cookiesStore";
import { useAtalhos, type HandlersAtalho } from "./lib/useAtalhos";
import { acharRequestPorItemPath } from "./lib/treeLookup";
import { saveRequest } from "./lib/ipc";
import type { RequestItem } from "./lib/types";

type AbaRequest = "params" | "headers" | "body" | "auth" | "script" | "tests";

const ABAS: { id: AbaRequest; rotulo: string }[] = [
  { id: "params", rotulo: "Params" },
  { id: "headers", rotulo: "Headers" },
  { id: "body", rotulo: "Body" },
  { id: "auth", rotulo: "Auth" },
  { id: "script", rotulo: "Script" },
  { id: "tests", rotulo: "Tests" },
];

type AbaPainel = "console" | "cookies" | "history";

const PAINEIS: { id: AbaPainel; rotulo: string }[] = [
  { id: "console", rotulo: "Console" },
  { id: "cookies", rotulo: "Cookies" },
  { id: "history", rotulo: "Historico" },
];

function App() {
  const restaurarColecoes = useCollectionsStore((s) => s.restaurarColecoes);
  const [aba, setAba] = useState<AbaRequest>("params");
  const [painel, setPainel] = useState<AbaPainel>("console");
  // Painel de variaveis/ambientes (EnvEditor) aberto sob demanda.
  const [varsAberto, setVarsAberto] = useState(false);
  // F10 — nomes de variaveis nao resolvidas no ultimo envio (so NOMES; nunca
  // valores/secrets). Aviso NAO bloqueante.
  const avisoVars = useRequestStore((s) => s.avisoVars);

  // ---- F15: costura aba-ativa <-> requestStore ----------------------------
  const activeId = useTabsStore((s) => s.activeId);
  const request = useRequestStore((s) => s.request);

  // Ao trocar de aba ativa, carrega o snapshot da aba no builder.
  // Guardamos o ultimo id "espelhado" para distinguir troca-de-aba (carregar do
  // snapshot) de edicao-na-mesma-aba (espelhar de volta).
  const idEspelhado = useRef<string | null>(null);
  useEffect(() => {
    if (activeId === idEspelhado.current) return;
    idEspelhado.current = activeId;
    if (activeId === null) return;
    const aba = useTabsStore.getState().tabs.find((t) => t.id === activeId);
    if (aba) {
      useRequestStore.getState().setRequest(aba.request);
    }
  }, [activeId]);

  // Ao editar a request da aba ativa, espelha de volta no snapshot da aba
  // (marca suja). So espelhamos quando a edicao e na MESMA aba ja carregada —
  // evita marcar suja na troca de aba (que tambem muda `request`).
  useEffect(() => {
    const idAtual = useTabsStore.getState().activeId;
    if (idAtual === null || idAtual !== idEspelhado.current) return;
    useTabsStore.getState().atualizarRequestAtiva(request);
  }, [request]);

  // ---- F14: registra o host de cada envio concluido (para listar cookies) --
  const loading = useRequestStore((s) => s.loading);
  const loadingAnterior = useRef(loading);
  useEffect(() => {
    const terminou = loadingAnterior.current && !loading;
    loadingAnterior.current = loading;
    if (!terminou) return;
    const st = useRequestStore.getState();
    const host = hostDeUrl(st.request.url);
    if (host) useCookiesStore.getState().registrarDominio(host);
  }, [loading]);

  // ---- Boot: restaura colecoes e, em seguida, as abas da sessao -----------
  useEffect(() => {
    void (async () => {
      await restaurarColecoes();
      useTabsStore.getState().restaurar((collectionPath, itemPath) => {
        if (collectionPath === null) return null;
        const col = useCollectionsStore.getState().collections[collectionPath];
        return acharRequestPorItemPath(col, itemPath);
      });
      // Se uma aba foi restaurada como ativa, carrega-a no builder.
      const ativa = useTabsStore.getState().activeId;
      if (ativa !== null) {
        const aba = useTabsStore.getState().tabs.find((t) => t.id === ativa);
        if (aba) {
          idEspelhado.current = ativa;
          useRequestStore.getState().setRequest(aba.request);
        }
      }
    })();
  }, [restaurarColecoes]);

  // ---- F15: atalhos de teclado --------------------------------------------
  const handlers: HandlersAtalho = useMemo(
    () => ({
      novaAba: () => {
        const id = useTabsStore.getState().abrirNova();
        idEspelhado.current = id;
        const aba = useTabsStore.getState().tabs.find((t) => t.id === id);
        if (aba) useRequestStore.getState().setRequest(aba.request);
      },
      fecharAba: () => {
        const id = useTabsStore.getState().activeId;
        if (id !== null) useTabsStore.getState().fecharAba(id);
      },
      salvar: () => void salvarRequestAtiva(),
      enviar: () => void useRequestStore.getState().enviar(),
    }),
    [],
  );
  useAtalhos(handlers);

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="app-title">ruan</span>
        <div className="app-header-tools">
          <EnvSelector />
          <button
            type="button"
            className="app-vars-btn"
            aria-pressed={varsAberto}
            onClick={() => setVarsAberto((v) => !v)}
          >
            Variaveis
          </button>
        </div>
      </header>
      <section className="app-body">
        <aside className="app-sidebar" aria-label="Colecoes">
          <CollectionToolbar />
          <Sidebar />
        </aside>
        <div className="app-main">
          <Tabs />

          <div className="rq-builder-wrap">
            <RequestBuilder />
          </div>

          <nav className="rq-tabs" role="tablist" aria-label="Editor da request">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={aba === a.id}
                className={`rq-tab ${aba === a.id ? "rq-tab-active" : ""}`}
                onClick={() => setAba(a.id)}
              >
                {a.rotulo}
              </button>
            ))}
          </nav>

          <div className="rq-tab-panel" role="tabpanel">
            {aba === "params" && <QueryParams />}
            {aba === "headers" && <Headers />}
            {aba === "body" && <BodyEditor />}
            {aba === "auth" && <AuthTab />}
            {aba === "script" && <ScriptEditor />}
            {aba === "tests" && <TestsPanel />}
          </div>

          {avisoVars.length > 0 && (
            <div className="rq-aviso-vars" role="status">
              Variaveis nao resolvidas: {avisoVars.join(", ")}
            </div>
          )}

          <div className="rq-response">
            <ResponseViewer />
          </div>

          <nav
            className="rq-tabs"
            role="tablist"
            aria-label="Paineis auxiliares"
          >
            {PAINEIS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={painel === p.id}
                className={`rq-tab ${painel === p.id ? "rq-tab-active" : ""}`}
                onClick={() => setPainel(p.id)}
              >
                {p.rotulo}
              </button>
            ))}
          </nav>

          <div className="rq-tab-panel" role="tabpanel">
            {painel === "console" && <ScriptConsole />}
            {painel === "cookies" && <CookiesPanel />}
            {painel === "history" && <HistoryPanel />}
          </div>
        </div>

        {varsAberto && (
          <aside className="app-vars-panel" aria-label="Variaveis e ambientes">
            <div className="app-vars-panel-head">
              <span>Variaveis e ambientes</span>
              <button
                type="button"
                className="app-vars-close"
                aria-label="Fechar painel de variaveis"
                onClick={() => setVarsAberto(false)}
              >
                x
              </button>
            </div>
            <EnvEditor />
          </aside>
        )}
      </section>
    </main>
  );
}

/**
 * Persiste a request da aba ativa no disco (Ctrl+S). So salva abas ligadas a uma
 * request de colecao (collectionPath/itemPath conhecidos); abas avulsas (ainda
 * nao salvas na arvore) sao ignoradas — a criacao de arquivo novo e do fluxo da
 * Sidebar. Apos salvar, limpa o "dot" de nao-salvo da aba.
 */
async function salvarRequestAtiva(): Promise<void> {
  const tabsState = useTabsStore.getState();
  const id = tabsState.activeId;
  if (id === null) return;
  const aba = tabsState.tabs.find((t) => t.id === id);
  if (!aba || aba.collectionPath === null || aba.itemPath === null) return;

  // O `itemPath` e "slugs/da/pasta/slug-da-request"; o `dir` para o save e tudo
  // menos o ultimo segmento (a request).
  const segmentos = aba.itemPath.split("/").filter((s) => s.length > 0);
  const dir =
    segmentos.length > 1 ? segmentos.slice(0, -1).join("/") : undefined;

  // Salva o estado ATUAL do builder (a aba ativa espelha a request em edicao).
  const request: RequestItem = useRequestStore.getState().request;
  try {
    await saveRequest(aba.collectionPath, request, dir);
    useTabsStore.getState().atualizarRequestDaAba(id, request, false);
  } catch {
    // Erro de escrita: mantem a aba suja; nao derruba a UI.
  }
}

export default App;
