// F19 — Command palette (Ctrl+K). Overlay com um input que mostra DUAS secoes:
//   1) Acoes (comandos) — nova request, nova colecao, enviar, abrir settings...
//      A Integracao (App.tsx) injeta as acoes REAIS via prop `comandos`. Sem prop,
//      um conjunto default minimo (nova aba, fechar palette) ja funciona.
//   2) Resultados de busca de requests/pastas nas colecoes abertas.
//
// Enter abre/executa o item selecionado; setas navegam (com wrap); Esc fecha.
// Abrir uma request: tabsStore.abrirRequest + requestStore.setRequest (mesma
// costura do Sidebar, garantindo a MESMA aba/identidade). Toda a logica de
// filtro/ordenacao/navegacao vem de lib/search.ts (pura, testada). Componente FINO.
//
// Sem emoji e sem lib de icone (regra do projeto).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useCollectionsStore } from "../store/collectionsStore";
import { useRequestStore } from "../store/requestStore";
import { useTabsStore } from "../store/tabsStore";
import {
  buscar,
  filtrarComandos,
  moverSelecao,
  type Comando,
  type ResultadoBusca,
} from "../lib/search";

/** Item unificado da lista do palette (comando OU resultado de busca). */
type Linha =
  | { kind: "comando"; cmd: Comando }
  | { kind: "resultado"; res: ResultadoBusca };

interface CommandPaletteProps {
  /** Aberto/fechado e controlado pela Integracao (atalho global Ctrl+K). */
  aberto: boolean;
  /** Fecha o palette (Esc, clique no backdrop, ou apos executar). */
  onFechar: () => void;
  /**
   * Acoes reais do app, injetadas pela Integracao. Cada `run` ja faz a acao
   * (criar request, enviar, abrir settings...). Se omitido, usa um default minimo.
   */
  comandos?: Comando[];
}

export function CommandPalette({ aberto, onFechar, comandos }: CommandPaletteProps) {
  const collections = useCollectionsStore((s) => s.collections);

  const [termo, setTermo] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEstilos();

  // Comandos efetivos: os injetados, ou um default minimo se nada veio.
  const cmdsBase = useMemo<Comando[]>(
    () => comandos ?? comandosDefault(),
    [comandos],
  );

  // Filtra comandos e busca requests/pastas pelo termo atual.
  const cmds = useMemo(() => filtrarComandos(cmdsBase, termo), [cmdsBase, termo]);
  const resultados = useMemo(
    () => buscar(collections, termo),
    [collections, termo],
  );

  // Lista linear unificada (comandos primeiro, depois resultados de busca).
  const linhas = useMemo<Linha[]>(
    () => [
      ...cmds.map((cmd) => ({ kind: "comando" as const, cmd })),
      ...resultados.map((res) => ({ kind: "resultado" as const, res })),
    ],
    [cmds, resultados],
  );

  // Ao abrir: limpa o termo, reseta selecao e foca o input.
  useEffect(() => {
    if (!aberto) return;
    setTermo("");
    setSel(0);
    // Foca no proximo tick (depois do overlay montar).
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [aberto]);

  // Mantem a selecao dentro dos limites quando a lista encolhe (ex: ao digitar).
  useEffect(() => {
    if (sel >= linhas.length) setSel(linhas.length > 0 ? linhas.length - 1 : 0);
  }, [linhas.length, sel]);

  if (!aberto) return null;

  function executar(linha: Linha) {
    if (linha.kind === "comando") {
      linha.cmd.run();
    } else {
      abrirResultado(linha.res);
    }
    onFechar();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => moverSelecao(s, 1, linhas.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => moverSelecao(s, -1, linhas.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const linha = linhas[sel];
      if (linha) executar(linha);
    }
  }

  return (
    <div
      className="cp-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        // Clique fora da caixa fecha; clique dentro nao.
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="cp-box" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cp-input"
          type="text"
          placeholder="Buscar requests, pastas ou acoes..."
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          aria-label="Buscar"
        />

        <div className="cp-lista" role="listbox" aria-label="Resultados">
          {linhas.length === 0 && (
            <div className="cp-vazio">Nenhum resultado.</div>
          )}

          {cmds.length > 0 && <div className="cp-secao">Acoes</div>}
          {cmds.map((cmd, i) => (
            <LinhaComando
              key={`c:${cmd.id}`}
              cmd={cmd}
              selecionado={sel === i}
              onHover={() => setSel(i)}
              onClick={() => executar({ kind: "comando", cmd })}
            />
          ))}

          {resultados.length > 0 && (
            <div className="cp-secao">Requests &amp; pastas</div>
          )}
          {resultados.map((res, i) => {
            const idx = cmds.length + i;
            return (
              <LinhaResultado
                key={`r:${res.collectionPath}:${res.itemPath}:${res.tipo}`}
                res={res}
                selecionado={sel === idx}
                onHover={() => setSel(idx)}
                onClick={() => executar({ kind: "resultado", res })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Linhas ----------------------------------------------------------------

interface LinhaComandoProps {
  cmd: Comando;
  selecionado: boolean;
  onHover: () => void;
  onClick: () => void;
}

function LinhaComando({ cmd, selecionado, onHover, onClick }: LinhaComandoProps) {
  return (
    <div
      className={`cp-row ${selecionado ? "cp-sel" : ""}`}
      role="option"
      aria-selected={selecionado}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        // mousedown (nao click) para nao perder o foco/blur antes de executar.
        e.preventDefault();
        onClick();
      }}
    >
      <span className="cp-tag cp-tag-acao">acao</span>
      <span className="cp-label">{cmd.label}</span>
      {cmd.secao && <span className="cp-meta">{cmd.secao}</span>}
    </div>
  );
}

interface LinhaResultadoProps {
  res: ResultadoBusca;
  selecionado: boolean;
  onHover: () => void;
  onClick: () => void;
}

function LinhaResultado({ res, selecionado, onHover, onClick }: LinhaResultadoProps) {
  return (
    <div
      className={`cp-row ${selecionado ? "cp-sel" : ""}`}
      role="option"
      aria-selected={selecionado}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {res.tipo === "request" ? (
        <span className="cp-tag cp-tag-metodo" title={res.method}>
          {(res.method || "GET").toUpperCase()}
        </span>
      ) : (
        <span className="cp-tag cp-tag-pasta">pasta</span>
      )}
      <span className="cp-label">{res.name}</span>
      {res.tipo === "request" && res.url && (
        <span className="cp-url">{res.url}</span>
      )}
      <span className="cp-meta">{res.collectionName}</span>
    </div>
  );
}

// ---- Acoes ------------------------------------------------------------------

/**
 * Abre uma request encontrada: usa a MESMA costura do Sidebar (abrirRequest na
 * aba + setRequest no builder), garantindo a mesma identidade de aba. Pastas
 * nao tem "abrir" — no-op (a UI ainda permite selecionar, util como filtro).
 */
function abrirResultado(res: ResultadoBusca): void {
  if (res.tipo !== "request" || !res.request) return;
  useTabsStore
    .getState()
    .abrirRequest(res.collectionPath, res.itemPath, res.request);
  useRequestStore.getState().setRequest(res.request);
}

/**
 * Conjunto default minimo de comandos, usado quando a Integracao nao injeta os
 * reais. Mantido conservador: so acoes que este componente consegue executar
 * sozinho sem tocar IPC (abrir aba nova). As acoes ricas (nova colecao no disco,
 * enviar, settings) vem por prop da Integracao.
 */
export function comandosDefault(): Comando[] {
  return [
    {
      id: "nova-aba",
      label: "Nova aba (request avulsa)",
      keywords: ["new", "tab", "request", "criar"],
      secao: "Abas",
      run: () => {
        useTabsStore.getState().abrirNova();
      },
    },
  ];
}

// ---- Estilos auto-contidos --------------------------------------------------
// Injetados uma vez. Usa as variaveis de tema ja definidas pelo App quando
// existirem, com fallbacks escuros.

const CP_STYLE_ID = "cp-estilos-f19";
const CP_CSS = `
.cp-backdrop {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
}
.cp-box {
  width: min(640px, 92vw);
  background: var(--bg-alt, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  overflow: hidden;
  display: flex; flex-direction: column;
}
.cp-input {
  width: 100%; box-sizing: border-box;
  background: transparent; border: none; outline: none;
  color: var(--fg, #d4d4d4);
  font-size: 15px; padding: 14px 16px;
  border-bottom: 1px solid var(--border, #333);
}
.cp-lista { max-height: 50vh; overflow-y: auto; padding: 6px 0; }
.cp-vazio { padding: 14px 16px; color: #888; font-size: 13px; }
.cp-secao {
  padding: 6px 16px 2px; color: #888;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.cp-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 16px; cursor: pointer;
  white-space: nowrap; overflow: hidden;
}
.cp-row.cp-sel { background: var(--accent, #4ec9b0); color: #1e1e1e; }
.cp-row.cp-sel .cp-meta,
.cp-row.cp-sel .cp-url { color: rgba(30,30,30,0.7); }
.cp-tag {
  font-size: 10px; font-weight: 700; min-width: 40px;
  text-align: center; padding: 1px 4px; border-radius: 3px;
  letter-spacing: 0.3px; flex: none;
}
.cp-tag-metodo { color: #4ec9b0; }
.cp-tag-acao { color: #c586c0; }
.cp-tag-pasta { color: #dcdcaa; }
.cp-label {
  flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis;
  font-size: 13px;
}
.cp-url {
  flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis;
  color: #888; font-size: 12px;
}
.cp-meta { flex: none; color: #888; font-size: 11px; margin-left: auto; }
`;

/** Hook que injeta o CSS do palette no <head> uma unica vez. */
function useEstilos() {
  useEffect(() => {
    if (document.getElementById(CP_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = CP_STYLE_ID;
    el.textContent = CP_CSS;
    document.head.appendChild(el);
  }, []);
}

export default CommandPalette;
