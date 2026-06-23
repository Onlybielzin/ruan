// Sidebar (F3): arvore de colecoes -> pastas -> requests, com CRUD via menu de
// contexto e drag-and-drop nativo (HTML5) para mover/reordenar. Componente FINO:
// toda a logica pura (ordenacao, reordenacao, nomes, cores) vem de lib/tree.ts;
// a persistencia e via os comandos IPC do tree_ops (registrados na Integracao).
//
// Sem emoji e sem lib de icone (regra do projeto). Triangulos de expandir e o
// badge de metodo sao texto/CSS.

import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";

import { useCollectionsStore } from "../store/collectionsStore";
import { slugFront } from "../store/collectionsStore";
import { useRequestStore } from "../store/requestStore";
import { useTabsStore } from "../store/tabsStore";
import { itemPathDe } from "../lib/treeLookup";
import type { Collection, TreeItem } from "../lib/types";
import { isFolder, isRequest } from "../lib/types";
import {
  corMetodo,
  kindOf,
  type ItemKind,
  nomeCopia,
  nomeNovoUnico,
  ordenarItems,
  reordenar,
  rotuloMetodo,
  seqParaPosicao,
  updatesNecessarios,
  validarNomeFront,
} from "../lib/tree";

// ---- Wrappers IPC proprios da F3 -------------------------------------------
// Cada um corresponde a um #[tauri::command] de tree_ops.rs, registrado na
// fase de Integracao. `dir` e o subdiretorio relativo a colecao (slugs unidos
// por "/") ou undefined para a raiz.

function ipcCreateRequest(
  collectionPath: string,
  dir: string | undefined,
  name: string,
  seq: number,
): Promise<string> {
  return invoke<string>("create_request_cmd", {
    collectionPath,
    dir,
    name,
    seq,
  });
}

function ipcRenameItem(
  collectionPath: string,
  dir: string | undefined,
  kind: ItemKind,
  oldName: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_item", {
    collectionPath,
    dir,
    kind,
    oldName,
    newName,
  });
}

function ipcDuplicateItem(
  collectionPath: string,
  dir: string | undefined,
  name: string,
  newName: string,
  seq: number,
): Promise<string> {
  return invoke<string>("duplicate_item", {
    collectionPath,
    dir,
    name,
    newName,
    seq,
  });
}

function ipcMoveItem(
  collectionPath: string,
  kind: ItemKind,
  fromDir: string | undefined,
  toDir: string | undefined,
  name: string,
  newSeq: number,
): Promise<string> {
  return invoke<string>("move_item", {
    collectionPath,
    kind,
    fromDir,
    toDir,
    name,
    newSeq,
  });
}

// ---- Helpers de caminho relativo -------------------------------------------

/** Junta segmentos de slug num `dir` relativo, ou undefined se vazio (raiz). */
function dirRelativo(segmentos: string[]): string | undefined {
  return segmentos.length === 0 ? undefined : segmentos.join("/");
}

/** Estende o caminho relativo de uma pasta com o slug do seu nome. */
function descer(segmentos: string[], nomePasta: string): string[] {
  return [...segmentos, slugFront(nomePasta)];
}

// ---- Estado de arrastar ----------------------------------------------------

interface DragInfo {
  collectionPath: string;
  /** dir relativo (slugs) onde o item arrastado vive. */
  dir: string | undefined;
  /** segmentos do dir do item arrastado (para comparar com o alvo). */
  segs: string[];
  name: string;
  kind: ItemKind;
  index: number;
}

// ---- Componente principal --------------------------------------------------

export function Sidebar() {
  const collections = useCollectionsStore((s) => s.collections);
  const ordem = useCollectionsStore((s) => s.ordem);
  const reloadCollection = useCollectionsStore((s) => s.reloadCollection);

  const [drag, setDrag] = useState<DragInfo | null>(null);

  useEstilos();

  const lista = useMemo(
    () => ordem.map((p) => [p, collections[p]] as const).filter(([, c]) => !!c),
    [ordem, collections],
  );

  if (lista.length === 0) {
    return (
      <div className="sb-vazio">Nenhuma colecao aberta</div>
    );
  }

  return (
    <div className="sb-root" role="tree">
      {lista.map(([path, col]) => (
        <CollectionNode
          key={path}
          path={path}
          collection={col}
          drag={drag}
          setDrag={setDrag}
          onMutate={() => void reloadCollection(path)}
        />
      ))}
    </div>
  );
}

// ---- No de colecao (raiz da arvore) ----------------------------------------

interface ColProps {
  path: string;
  collection: Collection;
  drag: DragInfo | null;
  setDrag: (d: DragInfo | null) => void;
  onMutate: () => void;
}

function CollectionNode({ path, collection, drag, setDrag, onMutate }: ColProps) {
  const [aberto, setAberto] = useState(true);
  const filhos = ordenarItems(collection.items);

  async function criarPasta() {
    const existentes = collection.items.filter(isFolder).map((i) => i.name);
    const nome = nomeNovoUnico("Nova pasta", existentes);
    await invoke("create_folder", {
      collectionPath: path,
      dir: undefined,
      name: nome,
      seq: collection.items.length,
    });
    onMutate();
  }

  async function criarRequest() {
    const existentes = collection.items.filter(isRequest).map((i) => i.name);
    const nome = nomeNovoUnico("Nova request", existentes);
    await ipcCreateRequest(path, undefined, nome, collection.items.length);
    onMutate();
  }

  return (
    <div className="sb-col" role="treeitem" aria-expanded={aberto}>
      <div
        className="sb-row sb-row-col"
        onClick={() => setAberto((v) => !v)}
        onContextMenu={(e) => {
          e.preventDefault();
          mostrarMenu(e, [
            { label: "Nova pasta", acao: () => void criarPasta() },
            { label: "Nova request", acao: () => void criarRequest() },
          ]);
        }}
      >
        <Triangulo aberto={aberto} />
        <span className="sb-nome sb-col-nome">{collection.name}</span>
      </div>
      {aberto && (
        <ItemList
          collectionPath={path}
          segmentos={[]}
          irmaos={filhos}
          drag={drag}
          setDrag={setDrag}
          onMutate={onMutate}
        />
      )}
    </div>
  );
}

// ---- Lista de irmaos (com zonas de drop para reordenar) --------------------

interface ListProps {
  collectionPath: string;
  segmentos: string[];
  irmaos: TreeItem[];
  drag: DragInfo | null;
  setDrag: (d: DragInfo | null) => void;
  onMutate: () => void;
}

function ItemList({
  collectionPath,
  segmentos,
  irmaos,
  drag,
  setDrag,
  onMutate,
}: ListProps) {
  const ordenados = ordenarItems(irmaos);
  const dir = dirRelativo(segmentos);

  // Persiste uma nova ordem: roda os move_item necessarios e recarrega.
  async function aplicarReordenacao(nova: TreeItem[]) {
    const updates = updatesNecessarios(nova);
    for (const u of updates) {
      await ipcMoveItem(collectionPath, u.kind, dir, dir, u.name, u.seq);
    }
    if (updates.length > 0) onMutate();
  }

  // Drop "antes do item no indice destino": so reordena dentro da mesma lista.
  async function onDropAntes(destino: number) {
    if (!drag) return;
    if (drag.collectionPath !== collectionPath) return;
    // Mesmo dir => reordenar. Dir diferente => mover para esta lista (no fim).
    if (igualSegs(drag.segs, segmentos)) {
      const idxOrigem = ordenados.findIndex(
        (i) => i.name === drag.name && kindOf(i) === drag.kind,
      );
      if (idxOrigem < 0) return;
      const nova = reordenar(ordenados, idxOrigem, destino);
      await aplicarReordenacao(nova);
    } else {
      await moverParaEstaLista(destino);
    }
    setDrag(null);
  }

  // Move o item arrastado (de outra pasta) para esta lista na posicao `destino`.
  async function moverParaEstaLista(destino: number) {
    if (!drag) return;
    const seq = seqParaPosicao(destino);
    await ipcMoveItem(
      collectionPath,
      drag.kind,
      drag.dir,
      dir,
      drag.name,
      seq,
    );
    onMutate();
  }

  return (
    <div className="sb-list">
      {ordenados.map((item, i) => (
        <ItemNode
          key={`${kindOf(item)}:${item.name}`}
          collectionPath={collectionPath}
          segmentos={segmentos}
          item={item}
          index={i}
          irmaos={ordenados}
          drag={drag}
          setDrag={setDrag}
          onMutate={onMutate}
          onDropAntes={onDropAntes}
        />
      ))}
      {/* Zona de drop no fim da lista (soltar depois do ultimo). */}
      <div
        className="sb-drop-fim"
        onDragOver={(e) => {
          if (drag) e.preventDefault();
        }}
        onDrop={() => void onDropAntes(ordenados.length)}
      />
    </div>
  );
}

function igualSegs(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i]);
}

// ---- No de item (pasta ou request) -----------------------------------------

interface NodeProps {
  collectionPath: string;
  segmentos: string[];
  item: TreeItem;
  index: number;
  irmaos: TreeItem[];
  drag: DragInfo | null;
  setDrag: (d: DragInfo | null) => void;
  onMutate: () => void;
  onDropAntes: (destino: number) => void;
}

function ItemNode(props: NodeProps) {
  const {
    collectionPath,
    segmentos,
    item,
    index,
    irmaos,
    drag,
    setDrag,
    onMutate,
    onDropAntes,
  } = props;

  const [aberto, setAberto] = useState(false);
  const dir = dirRelativo(segmentos);
  const kind = kindOf(item);

  async function renomear() {
    const novo = prompt(`Renomear "${item.name}" para:`, item.name);
    if (novo == null) return;
    const erro = validarNomeFront(novo);
    if (erro) {
      alert(erro);
      return;
    }
    await ipcRenameItem(collectionPath, dir, kind, item.name, novo);
    onMutate();
  }

  async function deletar() {
    if (!confirm(`Apagar "${item.name}"?`)) return;
    if (isRequest(item)) {
      await invoke("delete_request", {
        collectionPath,
        dir,
        name: item.name,
      });
    } else {
      // Pasta: nao ha comando dedicado; remover via mover para fora nao se
      // aplica. A delecao de pasta nao faz parte do escopo F3 (sem comando no
      // backend); avisa o usuario.
      alert("Apagar pasta nao esta disponivel ainda.");
      return;
    }
    onMutate();
  }

  async function duplicar() {
    if (!isRequest(item)) return;
    const existentes = irmaos.map((i) => i.name);
    const novo = nomeCopia(item.name, existentes);
    await ipcDuplicateItem(
      collectionPath,
      dir,
      item.name,
      novo,
      irmaos.length,
    );
    onMutate();
  }

  async function criarPastaDentro() {
    if (!isFolder(item)) return;
    const segDentro = descer(segmentos, item.name);
    const existentes = item.items.filter(isFolder).map((i) => i.name);
    const nome = nomeNovoUnico("Nova pasta", existentes);
    await invoke("create_folder", {
      collectionPath,
      dir: dirRelativo(segDentro),
      name: nome,
      seq: item.items.length,
    });
    setAberto(true);
    onMutate();
  }

  async function criarRequestDentro() {
    if (!isFolder(item)) return;
    const segDentro = descer(segmentos, item.name);
    const existentes = item.items.filter(isRequest).map((i) => i.name);
    const nome = nomeNovoUnico("Nova request", existentes);
    await ipcCreateRequest(
      collectionPath,
      dirRelativo(segDentro),
      nome,
      item.items.length,
    );
    setAberto(true);
    onMutate();
  }

  function abrirMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const itens: MenuItem[] = [];
    if (isFolder(item)) {
      itens.push(
        { label: "Nova pasta", acao: () => void criarPastaDentro() },
        { label: "Nova request", acao: () => void criarRequestDentro() },
      );
    }
    itens.push({ label: "Renomear", acao: () => void renomear() });
    if (isRequest(item)) {
      itens.push({ label: "Duplicar", acao: () => void duplicar() });
    }
    itens.push({ label: "Apagar", acao: () => void deletar() });
    mostrarMenu(e, itens);
  }

  // DnD nativo: a row inteira e arrastavel.
  function onDragStart(e: DragEvent) {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.name);
    setDrag({
      collectionPath,
      dir,
      segs: segmentos,
      name: item.name,
      kind,
      index,
    });
  }

  function podeSoltarAqui(): boolean {
    if (!drag) return false;
    if (drag.collectionPath !== collectionPath) return false;
    return true;
  }

  // Drop sobre o item: se for pasta, move o arrastado PARA DENTRO dela;
  // senao, reordena soltando ANTES deste item.
  async function onDropNoItem(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!drag) return;
    if (isFolder(item)) {
      // Move para dentro desta pasta (no fim).
      const segDentro = descer(segmentos, item.name);
      // Nao mover uma pasta para dentro de si mesma.
      if (drag.kind === "folder" && igualSegs(drag.segs, segmentos) &&
          slugFront(drag.name) === slugFront(item.name)) {
        setDrag(null);
        return;
      }
      const destino = dirRelativo(segDentro);
      await ipcMoveItem(
        collectionPath,
        drag.kind,
        drag.dir,
        destino,
        drag.name,
        item.items.length,
      );
      setAberto(true);
      onMutate();
      setDrag(null);
    } else {
      onDropAntes(index);
    }
  }

  return (
    <div
      className="sb-item"
      role="treeitem"
      aria-expanded={isFolder(item) ? aberto : undefined}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (podeSoltarAqui()) e.preventDefault();
      }}
      onDrop={(e) => void onDropNoItem(e)}
    >
      <div
        className={`sb-row ${isFolder(item) ? "sb-row-folder" : "sb-row-req"}`}
        onClick={() => {
          if (isFolder(item)) {
            setAberto((v) => !v);
          } else if (isRequest(item)) {
            // F15: abre (ou foca) uma aba para a request selecionada. A aba
            // ativa e espelhada no builder pela costura do App.tsx; aqui so
            // garantimos que o builder reflita a selecao imediatamente tambem.
            const itemPath = itemPathDe(dir, item.name);
            useTabsStore.getState().abrirRequest(collectionPath, itemPath, item);
            useRequestStore.getState().setRequest(item);
          }
        }}
        onContextMenu={abrirMenu}
      >
        {isFolder(item) ? (
          <Triangulo aberto={aberto} />
        ) : (
          <MetodoBadge method={item.method} />
        )}
        <span className="sb-nome">{item.name}</span>
      </div>
      {isFolder(item) && aberto && (
        <ItemList
          collectionPath={collectionPath}
          segmentos={descer(segmentos, item.name)}
          irmaos={item.items}
          drag={drag}
          setDrag={setDrag}
          onMutate={onMutate}
        />
      )}
    </div>
  );
}

// ---- Sub-componentes visuais -----------------------------------------------

function Triangulo({ aberto }: { aberto: boolean }) {
  // Texto puro (sem emoji): triangulo apontando para baixo/direita.
  return (
    <span className="sb-triangulo" aria-hidden>
      {aberto ? "▾" : "▸"}
    </span>
  );
}

function MetodoBadge({ method }: { method: string }) {
  return (
    <span
      className="sb-metodo"
      style={{ color: corMetodo(method) }}
      title={method}
    >
      {rotuloMetodo(method)}
    </span>
  );
}

// ---- Menu de contexto minimo (sem lib) -------------------------------------
// Implementacao leve: cria um <div> flutuante posicionado no clique. Some ao
// clicar fora ou escolher uma acao. Mantido fora do React tree para nao exigir
// portal/estado global — suficiente para o escopo F3.

interface MenuItem {
  label: string;
  acao: () => void;
}

function mostrarMenu(e: MouseEvent, itens: MenuItem[]) {
  fecharMenuAberto();
  const menu = document.createElement("div");
  menu.className = "sb-menu";
  menu.style.position = "fixed";
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.setAttribute("role", "menu");

  for (const it of itens) {
    const linha = document.createElement("div");
    linha.className = "sb-menu-item";
    linha.setAttribute("role", "menuitem");
    linha.textContent = it.label;
    linha.addEventListener("click", (ev) => {
      ev.stopPropagation();
      fecharMenuAberto();
      it.acao();
    });
    menu.appendChild(linha);
  }

  document.body.appendChild(menu);
  menuAberto = menu;

  // Fecha ao clicar fora (no proximo tick para nao pegar o clique atual).
  setTimeout(() => {
    document.addEventListener("click", fecharMenuAberto, { once: true });
    document.addEventListener("contextmenu", fecharMenuAberto, { once: true });
  }, 0);
}

let menuAberto: HTMLElement | null = null;

function fecharMenuAberto() {
  if (menuAberto && menuAberto.parentNode) {
    menuAberto.parentNode.removeChild(menuAberto);
  }
  menuAberto = null;
}

// ---- Estilos auto-contidos -------------------------------------------------
// Injetados uma unica vez. Mantem o componente utilizavel sem depender da
// Integracao mexer no App.css. Usa as variaveis de tema ja definidas la.

const SB_STYLE_ID = "sb-estilos-f3";
const SB_CSS = `
.sb-root { font-size: 13px; user-select: none; }
.sb-vazio { padding: 12px; color: #888; font-size: 13px; }
.sb-list { margin-left: 12px; }
.sb-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; cursor: pointer; border-radius: 3px;
  white-space: nowrap; overflow: hidden;
}
.sb-row:hover { background: rgba(255,255,255,0.06); }
.sb-col-nome { font-weight: 600; }
.sb-nome { overflow: hidden; text-overflow: ellipsis; }
.sb-triangulo { width: 12px; display: inline-block; color: #888; font-size: 10px; }
.sb-metodo {
  font-size: 10px; font-weight: 700; min-width: 34px;
  text-align: right; letter-spacing: 0.3px;
}
.sb-drop-fim { height: 6px; }
.sb-item[draggable="true"] { cursor: grab; }
.sb-menu {
  background: var(--bg-alt, #252526); border: 1px solid var(--border, #333);
  border-radius: 4px; padding: 4px 0; min-width: 140px; z-index: 1000;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4); font-size: 13px;
}
.sb-menu-item { padding: 5px 12px; cursor: pointer; color: var(--fg, #d4d4d4); }
.sb-menu-item:hover { background: var(--accent, #4ec9b0); color: #1e1e1e; }
`;

/** Hook que injeta o CSS da sidebar no <head> uma unica vez. */
function useEstilos() {
  useEffect(() => {
    if (document.getElementById(SB_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = SB_STYLE_ID;
    el.textContent = SB_CSS;
    document.head.appendChild(el);
  }, []);
}

export default Sidebar;
