// F2 — Barra de acoes no nivel do app: "Nova colecao" e "Abrir colecao".
// Componente FINO: delega toda a logica ao collectionsStore (criar/abrir, dialog
// de diretorio, persistencia). Sem libs de icone — botoes de texto.
//
// NAO montado no App.tsx aqui; a fase de Integracao posiciona na sidebar.

import { useState } from "react";
import { useCollectionsStore } from "../store/collectionsStore";

/** Estilos inline minimos, reusando as CSS vars do tema escuro (App.css). */
const estilos: Record<string, React.CSSProperties> = {
  barra: {
    display: "flex",
    gap: 6,
    padding: 8,
    borderBottom: "1px solid var(--border)",
  },
  botao: {
    flex: 1,
    padding: "6px 8px",
    fontSize: 12,
    color: "var(--fg)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    cursor: "pointer",
  },
  form: {
    display: "flex",
    gap: 6,
    padding: 8,
    borderBottom: "1px solid var(--border)",
  },
  input: {
    flex: 1,
    padding: "6px 8px",
    fontSize: 12,
    color: "var(--fg)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
  },
  erro: {
    padding: "4px 8px",
    fontSize: 11,
    color: "#f48771",
  },
};

export function CollectionToolbar() {
  const abrirColecao = useCollectionsStore((s) => s.abrirColecao);
  const criarColecao = useCollectionsStore((s) => s.criarColecao);
  const loading = useCollectionsStore((s) => s.loading);
  const error = useCollectionsStore((s) => s.error);

  // Form inline de "nova colecao": mostra um campo de nome; ao confirmar, abre o
  // dialog de diretorio (no store) e cria. Evita um modal pesado nesta fase.
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");

  function confirmarCriar() {
    const limpo = nome.trim();
    if (!limpo) return;
    void criarColecao(limpo);
    setNome("");
    setCriando(false);
  }

  function cancelarCriar() {
    setNome("");
    setCriando(false);
  }

  return (
    <div>
      {criando ? (
        <div style={estilos.form}>
          <input
            style={estilos.input}
            autoFocus
            value={nome}
            placeholder="Nome da colecao"
            aria-label="Nome da nova colecao"
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarCriar();
              if (e.key === "Escape") cancelarCriar();
            }}
          />
          <button
            type="button"
            style={estilos.botao}
            onClick={confirmarCriar}
            disabled={loading || nome.trim().length === 0}
          >
            Criar
          </button>
          <button type="button" style={estilos.botao} onClick={cancelarCriar}>
            Cancelar
          </button>
        </div>
      ) : (
        <div style={estilos.barra}>
          <button
            type="button"
            style={estilos.botao}
            onClick={() => setCriando(true)}
            disabled={loading}
          >
            Nova colecao
          </button>
          <button
            type="button"
            style={estilos.botao}
            onClick={() => void abrirColecao()}
            disabled={loading}
          >
            Abrir colecao
          </button>
        </div>
      )}
      {error ? (
        <div style={estilos.erro} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default CollectionToolbar;
