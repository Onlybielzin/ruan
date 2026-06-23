// QueryParams (F5): tabela key/value de query params, sincronizada com a URL.
// Componente FINO: toda a logica de parse/build vive em ../lib/queryParams.ts.
// Le/escreve o request atual via requestStore.atualizarRequest (F4) sem editar
// o store. Estilos inline (tema escuro coerente com App.css), pois App.css esta
// fora da propriedade desta feature.

import type { ChangeEvent } from "react";
import { useRequestStore } from "../store/requestStore";
import type { KeyValue } from "../lib/types";
import {
  type ParamRow,
  keyValueParaRow,
  rowParaKeyValue,
  buildUrl,
  linhaVazia,
} from "../lib/queryParams";

export function QueryParams() {
  const url = useRequestStore((s) => s.request.url);
  const params = useRequestStore((s) => s.request.params);
  const atualizarRequest = useRequestStore((s) => s.atualizarRequest);

  // Linhas exibidas = params do store (como ParamRow) + sempre uma linha vazia
  // ao final para adicionar (estilo planilha). A linha vazia nao e persistida
  // ate ganhar um nome.
  const linhas: ParamRow[] = params.map(keyValueParaRow);

  /**
   * Aplica uma nova lista de linhas: persiste em `params` (descartando a linha
   * de rascunho final totalmente vazia) e reconstroi a URL a partir das linhas
   * habilitadas+nomeadas, preservando base e fragmento.
   */
  const commit = (novas: ParamRow[]) => {
    const limpas = novas.filter(
      (l, i) =>
        // mantem tudo, menos uma eventual ultima linha 100% vazia (rascunho)
        !(i === novas.length - 1 && ehVazia(l)),
    );
    const novosParams: KeyValue[] = limpas.map(rowParaKeyValue);
    const novaUrl = buildUrl(url, limpas);
    atualizarRequest({ params: novosParams, url: novaUrl });
  };

  const onCampo = (
    indice: number,
    campo: "name" | "value" | "description",
    valor: string,
  ) => {
    const copia = linhas.map((l) => ({ ...l }));
    // Editando a linha de rascunho (indice == length): materializa-a.
    if (indice >= copia.length) {
      copia.push({ ...linhaVazia(), [campo]: valor });
    } else {
      copia[indice] = { ...copia[indice], [campo]: valor };
    }
    commit(copia);
  };

  const onToggle = (indice: number, enabled: boolean) => {
    if (indice >= linhas.length) return; // rascunho nao tem toggle util ainda
    const copia = linhas.map((l) => ({ ...l }));
    copia[indice] = { ...copia[indice], enabled };
    commit(copia);
  };

  const onRemover = (indice: number) => {
    if (indice >= linhas.length) return;
    const copia = linhas.filter((_, i) => i !== indice);
    commit(copia);
  };

  // Sempre renderiza uma linha de rascunho extra ao final.
  const linhasComRascunho: ParamRow[] = [...linhas, linhaVazia()];

  return (
    <div className="query-params" style={estilos.wrap}>
      <table style={estilos.tabela}>
        <thead>
          <tr>
            <th style={estilos.thCheck} />
            <th style={estilos.th}>Nome</th>
            <th style={estilos.th}>Valor</th>
            <th style={estilos.th}>Descricao</th>
            <th style={estilos.thAcao} />
          </tr>
        </thead>
        <tbody>
          {linhasComRascunho.map((linha, i) => {
            const ehRascunho = i >= linhas.length;
            return (
              <tr key={i}>
                <td style={estilos.tdCheck}>
                  {!ehRascunho && (
                    <input
                      type="checkbox"
                      aria-label={`Habilitar parametro ${linha.name || i + 1}`}
                      checked={linha.enabled}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        onToggle(i, e.target.checked)
                      }
                    />
                  )}
                </td>
                <td style={estilos.td}>
                  <input
                    type="text"
                    aria-label="Nome do parametro"
                    placeholder="nome"
                    value={linha.name}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => onCampo(i, "name", e.target.value)}
                    style={estilos.input}
                  />
                </td>
                <td style={estilos.td}>
                  <input
                    type="text"
                    aria-label="Valor do parametro"
                    placeholder="valor"
                    value={linha.value}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => onCampo(i, "value", e.target.value)}
                    style={estilos.input}
                  />
                </td>
                <td style={estilos.td}>
                  <input
                    type="text"
                    aria-label="Descricao do parametro"
                    placeholder="descricao (opcional)"
                    value={linha.description ?? ""}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => onCampo(i, "description", e.target.value)}
                    style={estilos.input}
                  />
                </td>
                <td style={estilos.tdAcao}>
                  {!ehRascunho && (
                    <button
                      type="button"
                      aria-label="Remover parametro"
                      title="Remover"
                      onClick={() => onRemover(i)}
                      style={estilos.remover}
                    >
                      X
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** True se a linha esta 100% vazia (rascunho descartavel). */
function ehVazia(l: ParamRow): boolean {
  return l.name.length === 0 && l.value.length === 0 && !l.description;
}

const estilos: Record<string, React.CSSProperties> = {
  wrap: {
    width: "100%",
    overflowX: "auto",
  },
  tabela: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.85rem",
  },
  th: {
    textAlign: "left",
    color: "#9a9a9a",
    fontWeight: 600,
    padding: "0.3rem 0.4rem",
    borderBottom: "1px solid #3a3a3a",
  },
  thCheck: {
    width: "1.8rem",
    borderBottom: "1px solid #3a3a3a",
  },
  thAcao: {
    width: "2rem",
    borderBottom: "1px solid #3a3a3a",
  },
  td: {
    padding: "0.15rem 0.4rem",
    borderBottom: "1px solid #2a2a2a",
  },
  tdCheck: {
    textAlign: "center",
    padding: "0.15rem 0.2rem",
    borderBottom: "1px solid #2a2a2a",
  },
  tdAcao: {
    textAlign: "center",
    padding: "0.15rem 0.2rem",
    borderBottom: "1px solid #2a2a2a",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#1e1e1e",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.3rem 0.45rem",
    fontFamily: "monospace",
  },
  remover: {
    background: "transparent",
    color: "#f87171",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.1rem 0.4rem",
    cursor: "pointer",
    fontWeight: 700,
  },
};

export default QueryParams;
