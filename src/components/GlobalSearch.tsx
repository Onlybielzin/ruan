// F19 — Caixa de busca para a sidebar (opcional). Versao "sempre visivel" do
// palette: um input que, ao digitar, lista resultados de busca de requests/pastas
// das colecoes abertas. Clicar abre a request (mesma costura do Sidebar/palette).
//
// Reusa a logica pura de lib/search.ts (buscar/moverSelecao). Componente FINO.
// Diferente do CommandPalette, NAO mostra acoes — so navegacao por requests/pastas.
//
// Sem emoji e sem lib de icone (regra do projeto).

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { useCollectionsStore } from "../store/collectionsStore";
import { useRequestStore } from "../store/requestStore";
import { useTabsStore } from "../store/tabsStore";
import { buscar, moverSelecao, type ResultadoBusca } from "../lib/search";

/** Abre a request encontrada (mesma identidade de aba do Sidebar). */
function abrirResultado(res: ResultadoBusca): void {
  if (res.tipo !== "request" || !res.request) return;
  useTabsStore
    .getState()
    .abrirRequest(res.collectionPath, res.itemPath, res.request);
  useRequestStore.getState().setRequest(res.request);
}

export function GlobalSearch() {
  const collections = useCollectionsStore((s) => s.collections);
  const [termo, setTermo] = useState("");
  const [sel, setSel] = useState(0);

  const resultados = useMemo(
    () => buscar(collections, termo),
    [collections, termo],
  );

  // Mantem a selecao valida quando a lista muda.
  useEffect(() => {
    if (sel >= resultados.length) {
      setSel(resultados.length > 0 ? resultados.length - 1 : 0);
    }
  }, [resultados.length, sel]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (resultados.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => moverSelecao(s, 1, resultados.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => moverSelecao(s, -1, resultados.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = resultados[sel];
      if (r) {
        abrirResultado(r);
        setTermo("");
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTermo("");
    }
  }

  const mostrarLista = termo.trim() !== "";

  return (
    <div style={estilos.container} className="gs-root">
      <input
        type="text"
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value);
          setSel(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Buscar..."
        aria-label="Buscar requests"
        style={estilos.input}
      />

      {mostrarLista && (
        <div style={estilos.lista} role="listbox" aria-label="Resultados da busca">
          {resultados.length === 0 && (
            <div style={estilos.vazio}>Nada encontrado.</div>
          )}
          {resultados.map((res, i) => (
            <div
              key={`${res.collectionPath}:${res.itemPath}:${res.tipo}`}
              role="option"
              aria-selected={sel === i}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                abrirResultado(res);
                setTermo("");
              }}
              style={{
                ...estilos.item,
                ...(sel === i ? estilos.itemSel : null),
              }}
            >
              <span style={estilos.tag}>
                {res.tipo === "request"
                  ? (res.method || "GET").toUpperCase()
                  : "pasta"}
              </span>
              <span style={estilos.nome}>{res.name}</span>
              <span style={estilos.meta}>{res.collectionName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const estilos: Record<string, CSSProperties> = {
  container: { width: "100%", display: "flex", flexDirection: "column", gap: 0 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: "4px",
    color: "#cdd0d4",
    fontSize: "13px",
    padding: "6px 8px",
    outline: "none",
  },
  lista: {
    marginTop: "4px",
    maxHeight: "240px",
    overflowY: "auto",
    border: "1px solid #2a2a2a",
    borderRadius: "4px",
    background: "#1a1a1a",
  },
  vazio: { padding: "8px", color: "#888", fontSize: "12px" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 8px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    overflow: "hidden",
  },
  itemSel: { background: "rgba(78,201,176,0.18)" },
  tag: {
    fontSize: "10px",
    fontWeight: 700,
    minWidth: "34px",
    textAlign: "right",
    color: "#4ec9b0",
    flex: "none",
    letterSpacing: "0.3px",
  },
  nome: {
    flex: "0 1 auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontSize: "13px",
    color: "#cdd0d4",
  },
  meta: { flex: "none", marginLeft: "auto", color: "#888", fontSize: "11px" },
};

export default GlobalSearch;
