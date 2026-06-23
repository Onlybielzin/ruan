// F6 — Editor de headers da request. Tabela key/value com enable/disable e
// descricao, mais autocomplete dos nomes de header comuns no campo "name".
// Componente FINO: toda logica pura mora em src/lib/headers.ts; le/escreve o
// request via requestStore.atualizarRequest. Estilos inline (tema escuro),
// coerentes com RequestBuilder.tsx, pra nao depender de App.css.

import { useId, useState } from "react";
import type { ChangeEvent } from "react";
import type { KeyValue } from "../lib/types";
import { useRequestStore } from "../store/requestStore";
import { HEADER_NAMES_COMUNS, filtrarSugestoes } from "../lib/headers";

/** Linha vazia (enabled por padrao) usada ao adicionar um header novo. */
function linhaVazia(): KeyValue {
  return { name: "", value: "", enabled: true, description: "" };
}

export function Headers() {
  const headers = useRequestStore((s) => s.request.headers);
  const atualizarRequest = useRequestStore((s) => s.atualizarRequest);

  // Indice da linha cujo dropdown de sugestoes esta aberto (-1 = nenhum).
  const [sugestoesAbertas, setSugestoesAbertas] = useState<number>(-1);
  const listId = useId();

  // Aplica um novo array de headers no store (substitui o array inteiro).
  const escrever = (novos: KeyValue[]) => {
    atualizarRequest({ headers: novos });
  };

  const atualizarLinha = (indice: number, patch: Partial<KeyValue>) => {
    escrever(headers.map((h, i) => (i === indice ? { ...h, ...patch } : h)));
  };

  const removerLinha = (indice: number) => {
    escrever(headers.filter((_, i) => i !== indice));
    setSugestoesAbertas(-1);
  };

  const adicionarLinha = () => {
    escrever([...headers, linhaVazia()]);
  };

  const onNome = (indice: number) => (e: ChangeEvent<HTMLInputElement>) => {
    atualizarLinha(indice, { name: e.target.value });
    setSugestoesAbertas(indice);
  };

  const onValor = (indice: number) => (e: ChangeEvent<HTMLInputElement>) => {
    atualizarLinha(indice, { value: e.target.value });
  };

  const onDescricao =
    (indice: number) => (e: ChangeEvent<HTMLInputElement>) => {
      atualizarLinha(indice, { description: e.target.value });
    };

  const onEnabled = (indice: number) => (e: ChangeEvent<HTMLInputElement>) => {
    atualizarLinha(indice, { enabled: e.target.checked });
  };

  const escolherSugestao = (indice: number, nome: string) => {
    atualizarLinha(indice, { name: nome });
    setSugestoesAbertas(-1);
  };

  return (
    <div className="headers-editor" style={estilos.wrapper}>
      <table style={estilos.tabela}>
        <thead>
          <tr>
            <th style={estilos.thCheck} scope="col">
              <span style={estilos.thLabel}>On</span>
            </th>
            <th style={estilos.th} scope="col">
              Nome
            </th>
            <th style={estilos.th} scope="col">
              Valor
            </th>
            <th style={estilos.th} scope="col">
              Descricao
            </th>
            <th style={estilos.thAcao} scope="col" aria-label="Acoes" />
          </tr>
        </thead>
        <tbody>
          {headers.length === 0 && (
            <tr>
              <td colSpan={5} style={estilos.vazio}>
                Nenhum header. Use "Adicionar header" abaixo.
              </td>
            </tr>
          )}
          {headers.map((h, i) => {
            const sugestoes =
              sugestoesAbertas === i ? filtrarSugestoes(h.name) : [];
            return (
              <tr key={i}>
                <td style={estilos.tdCheck}>
                  <input
                    type="checkbox"
                    aria-label={`Habilitar header ${i + 1}`}
                    checked={h.enabled}
                    onChange={onEnabled(i)}
                  />
                </td>
                <td style={estilos.td}>
                  <div style={estilos.nomeWrap}>
                    <input
                      type="text"
                      aria-label={`Nome do header ${i + 1}`}
                      placeholder="Content-Type"
                      value={h.name}
                      onChange={onNome(i)}
                      onFocus={() => setSugestoesAbertas(i)}
                      onBlur={() => {
                        // Atraso pra permitir o clique numa sugestao registrar
                        // antes do dropdown fechar.
                        window.setTimeout(() => {
                          setSugestoesAbertas((cur) => (cur === i ? -1 : cur));
                        }, 120);
                      }}
                      spellCheck={false}
                      autoComplete="off"
                      list={`${listId}-${i}`}
                      style={estilos.input}
                    />
                    {/* datalist nativo: autocomplete acessivel sem JS extra. */}
                    <datalist id={`${listId}-${i}`}>
                      {HEADER_NAMES_COMUNS.map((nome) => (
                        <option key={nome} value={nome} />
                      ))}
                    </datalist>
                    {sugestoes.length > 0 && (
                      <ul
                        role="listbox"
                        aria-label="Sugestoes de header"
                        style={estilos.dropdown}
                      >
                        {sugestoes.map((nome) => (
                          <li key={nome} style={estilos.dropItem}>
                            <button
                              type="button"
                              // onMouseDown roda antes do onBlur do input,
                              // garantindo que a escolha seja aplicada.
                              onMouseDown={(ev) => {
                                ev.preventDefault();
                                escolherSugestao(i, nome);
                              }}
                              style={estilos.dropBtn}
                            >
                              {nome}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </td>
                <td style={estilos.td}>
                  <input
                    type="text"
                    aria-label={`Valor do header ${i + 1}`}
                    placeholder="application/json"
                    value={h.value}
                    onChange={onValor(i)}
                    spellCheck={false}
                    autoComplete="off"
                    style={estilos.input}
                  />
                </td>
                <td style={estilos.td}>
                  <input
                    type="text"
                    aria-label={`Descricao do header ${i + 1}`}
                    placeholder="(opcional)"
                    value={h.description ?? ""}
                    onChange={onDescricao(i)}
                    spellCheck={false}
                    autoComplete="off"
                    style={estilos.input}
                  />
                </td>
                <td style={estilos.tdAcao}>
                  <button
                    type="button"
                    aria-label={`Remover header ${i + 1}`}
                    title="Remover"
                    onClick={() => removerLinha(i)}
                    style={estilos.remover}
                  >
                    x
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button type="button" onClick={adicionarLinha} style={estilos.adicionar}>
        + Adicionar header
      </button>
    </div>
  );
}

// Estilos inline minimos, tema escuro coerente com RequestBuilder.tsx.
const estilos: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    width: "100%",
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
    padding: "0.25rem 0.4rem",
    borderBottom: "1px solid #3a3a3a",
  },
  thCheck: {
    width: "2.2rem",
    textAlign: "center",
    borderBottom: "1px solid #3a3a3a",
    padding: "0.25rem 0.4rem",
  },
  thAcao: {
    width: "2.2rem",
    borderBottom: "1px solid #3a3a3a",
  },
  thLabel: {
    color: "#9a9a9a",
    fontWeight: 600,
    fontSize: "0.75rem",
  },
  td: {
    padding: "0.2rem 0.4rem",
    verticalAlign: "top",
  },
  tdCheck: {
    textAlign: "center",
    padding: "0.4rem",
    verticalAlign: "middle",
  },
  tdAcao: {
    textAlign: "center",
    padding: "0.2rem",
    verticalAlign: "middle",
  },
  nomeWrap: {
    position: "relative",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#1e1e1e",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.35rem 0.5rem",
    fontFamily: "monospace",
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    zIndex: 20,
    margin: "2px 0 0",
    padding: 0,
    listStyle: "none",
    maxHeight: "12rem",
    overflowY: "auto",
    background: "#1e1e1e",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
  },
  dropItem: {
    margin: 0,
    padding: 0,
  },
  dropBtn: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "transparent",
    color: "#e0e0e0",
    border: "none",
    padding: "0.35rem 0.6rem",
    fontFamily: "monospace",
    fontSize: "0.82rem",
    cursor: "pointer",
  },
  remover: {
    background: "transparent",
    color: "#f87171",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.2rem 0.45rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  adicionar: {
    alignSelf: "flex-start",
    background: "#1e1e1e",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: "4px",
    padding: "0.4rem 0.8rem",
    cursor: "pointer",
    fontWeight: 600,
  },
  vazio: {
    color: "#777",
    fontStyle: "italic",
    padding: "0.6rem 0.4rem",
  },
};

export default Headers;
