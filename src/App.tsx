import { useEffect, useState } from "react";
import "./App.css";

import CollectionToolbar from "./components/CollectionToolbar";
import Sidebar from "./components/Sidebar";
import RequestBuilder from "./components/RequestBuilder";
import QueryParams from "./components/QueryParams";
import Headers from "./components/Headers";
import BodyEditor from "./components/BodyEditor";
import ResponseViewer from "./components/ResponseViewer";
import { useCollectionsStore } from "./store/collectionsStore";

type AbaRequest = "params" | "headers" | "body";

const ABAS: { id: AbaRequest; rotulo: string }[] = [
  { id: "params", rotulo: "Params" },
  { id: "headers", rotulo: "Headers" },
  { id: "body", rotulo: "Body" },
];

function App() {
  const restaurarColecoes = useCollectionsStore((s) => s.restaurarColecoes);
  const [aba, setAba] = useState<AbaRequest>("params");

  // Reabre as colecoes persistidas da sessao anterior, uma vez no start.
  useEffect(() => {
    void restaurarColecoes();
  }, [restaurarColecoes]);

  return (
    <main className="app-shell">
      <header className="app-header">ruan</header>
      <section className="app-body">
        <aside className="app-sidebar" aria-label="Colecoes">
          <CollectionToolbar />
          <Sidebar />
        </aside>
        <div className="app-main">
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
          </div>

          <div className="rq-response">
            <ResponseViewer />
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
