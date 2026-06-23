// F15 — Barra de abas (multi-request). Componente FINO: toda a logica de abrir/
// fechar/ativar/reordenar/sujo vem de `lib/tabs.ts` via `tabsStore`. Aqui so
// renderizamos a barra, o dot de nao-salvo e o botao de fechar, com DnD nativo
// para reordenar.
//
// Sem emoji e sem lib de icone (regra do projeto): o dot e um CSS bullet e o
// fechar e um "x" textual. Estilos auto-injetados (igual a Sidebar) para nao
// depender da Integracao mexer no App.css.

import { useEffect, useState, type DragEvent, type MouseEvent } from "react";

import { useTabsStore } from "../store/tabsStore";

export function Tabs() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const ativarAba = useTabsStore((s) => s.ativarAba);
  const fecharAba = useTabsStore((s) => s.fecharAba);
  const reordenarAba = useTabsStore((s) => s.reordenarAba);
  const abrirNova = useTabsStore((s) => s.abrirNova);

  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEstilosTabs();

  if (tabs.length === 0) {
    // Sem abas: mostra so o botao de nova aba (a Integracao tambem pode ocultar
    // a barra toda; aqui mantemos o "+" para o usuario nunca ficar preso).
    return (
      <div className="tb-bar" role="tablist" aria-label="Requests abertas">
        <button
          type="button"
          className="tb-nova"
          aria-label="Nova aba"
          title="Nova aba (Ctrl+T)"
          onClick={() => abrirNova()}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="tb-bar" role="tablist" aria-label="Requests abertas">
      {tabs.map((t, i) => {
        const ativa = t.id === activeId;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={ativa}
            className={`tb-aba ${ativa ? "tb-aba-ativa" : ""}`}
            title={t.title}
            draggable
            onClick={() => ativarAba(t.id)}
            onAuxClick={(e: MouseEvent) => {
              // Botao do meio fecha a aba (convencao de navegadores).
              if (e.button === 1) {
                e.preventDefault();
                fecharAba(t.id);
              }
            }}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e: DragEvent) => {
              if (dragIdx !== null) e.preventDefault();
            }}
            onDrop={() => {
              if (dragIdx !== null && dragIdx !== i) reordenarAba(dragIdx, i);
              setDragIdx(null);
            }}
            onDragEnd={() => setDragIdx(null)}
          >
            {t.sujo && (
              <span className="tb-dot" aria-label="Alteracoes nao salvas" />
            )}
            <span className="tb-titulo">{t.title || "Request"}</span>
            <button
              type="button"
              className="tb-fechar"
              aria-label={`Fechar ${t.title || "aba"}`}
              title="Fechar (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                fecharAba(t.id);
              }}
            >
              x
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="tb-nova"
        aria-label="Nova aba"
        title="Nova aba (Ctrl+T)"
        onClick={() => abrirNova()}
      >
        +
      </button>
    </div>
  );
}

// ---- Estilos auto-contidos (injetados uma unica vez) -----------------------

const TB_STYLE_ID = "tb-estilos-f15";
const TB_CSS = `
.tb-bar {
  display: flex; align-items: stretch; gap: 2px;
  border-bottom: 1px solid var(--border, #333);
  background: var(--bg-alt, #252526);
  overflow-x: auto; user-select: none; font-size: 13px;
}
.tb-aba {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px 5px 10px; cursor: pointer;
  border-right: 1px solid var(--border, #333);
  color: var(--fg-dim, #aaa); max-width: 220px; white-space: nowrap;
}
.tb-aba:hover { background: rgba(255,255,255,0.05); }
.tb-aba-ativa {
  background: var(--bg, #1e1e1e); color: var(--fg, #d4d4d4);
  box-shadow: inset 0 -2px 0 var(--accent, #4ec9b0);
}
.tb-titulo { overflow: hidden; text-overflow: ellipsis; }
.tb-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent, #4ec9b0); flex: 0 0 auto;
}
.tb-fechar {
  border: none; background: transparent; color: inherit;
  cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px;
  border-radius: 3px; opacity: 0.6;
}
.tb-fechar:hover { opacity: 1; background: rgba(255,255,255,0.12); }
.tb-nova {
  border: none; background: transparent; color: var(--fg-dim, #aaa);
  cursor: pointer; font-size: 16px; line-height: 1; padding: 4px 10px;
}
.tb-nova:hover { color: var(--fg, #d4d4d4); background: rgba(255,255,255,0.05); }
`;

/** Injeta o CSS das abas no <head> uma unica vez. */
function useEstilosTabs() {
  useEffect(() => {
    if (document.getElementById(TB_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = TB_STYLE_ID;
    el.textContent = TB_CSS;
    document.head.appendChild(el);
  }, []);
}

export default Tabs;
