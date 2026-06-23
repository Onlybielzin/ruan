// F17 — Import / Export. Componente FINO: orquestra a UI (escolher formato,
// abrir/colar/salvar arquivo) e delega TODA a logica de parsing/serializacao
// para os modulos puros (src/lib/import/*, src/lib/export.ts). A persistencia da
// colecao importada usa os COMANDOS EXISTENTES via IPC (create_collection +
// create_folder + save_request) — nenhum comando Rust novo.
//
// Integracao (App.tsx) deve montar <ImportExportPanel /> em algum lugar do
// header/sidebar e, ao concluir import, chamar onImported(path) se quiser focar
// a colecao recem-criada (passamos o caminho via callback opcional).

import { useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parsePostman } from "../lib/import/postman";
import { parseOpenapi } from "../lib/import/openapi";
import { parseCurl, type ImportResult, type ParseResult } from "../lib/import/curl";
import {
  paraPostmanString,
  planoDePersistencia,
  type OpPersistencia,
} from "../lib/export";
import { createFolder, saveRequest } from "../lib/ipc";
import {
  useCollectionsStore,
  ipcCreateCollection,
} from "../store/collectionsStore";
import type { Collection } from "../lib/types";

type Formato = "postman" | "openapi" | "curl";

const FORMATOS: Array<{ id: Formato; label: string }> = [
  { id: "postman", label: "Postman v2.1" },
  { id: "openapi", label: "OpenAPI / Swagger" },
  { id: "curl", label: "cURL" },
];

/** Seleciona o parser puro conforme o formato. PURO (mapa de funcoes). */
export function parserDe(
  formato: Formato,
): (texto: string) => ParseResult {
  switch (formato) {
    case "postman":
      return parsePostman;
    case "openapi":
      return parseOpenapi;
    case "curl":
      return parseCurl;
  }
}

const estilos: Record<string, React.CSSProperties> = {
  painel: { display: "flex", flexDirection: "column", gap: 8, padding: 8 },
  linha: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  botao: {
    padding: "6px 10px",
    fontSize: 12,
    color: "var(--fg)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    cursor: "pointer",
  },
  select: {
    padding: "5px 8px",
    fontSize: 12,
    color: "var(--fg)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
  },
  textarea: {
    width: "100%",
    minHeight: 120,
    fontFamily: "monospace",
    fontSize: 12,
    color: "var(--fg)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: 6,
    resize: "vertical",
  },
  msg: { fontSize: 11, color: "var(--muted, #8a8a8a)" },
  erro: { fontSize: 11, color: "#f48771" },
  titulo: { fontSize: 12, fontWeight: 600, color: "var(--fg)" },
};

export interface ImportExportPanelProps {
  /** Chamado com o caminho da colecao apos um import bem-sucedido. */
  onImported?: (path: string) => void | Promise<void>;
}

export function ImportExportPanel({ onImported }: ImportExportPanelProps) {
  const [formato, setFormato] = useState<Formato>("postman");
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const collections = useCollectionsStore((s) => s.collections);
  const activePath = useCollectionsStore((s) => s.activePath);
  const openCollection = useCollectionsStore((s) => s.openCollection);

  function limparMensagens() {
    setErro(null);
    setInfo(null);
  }

  /** Le um arquivo do disco para o textarea. */
  async function escolherArquivo() {
    limparMensagens();
    try {
      const sel = await openDialog({ multiple: false, directory: false });
      const caminho = Array.isArray(sel) ? (sel[0] ?? null) : sel;
      if (!caminho) return;
      const conteudo = await readTextFile(caminho);
      setTexto(conteudo);
      setInfo(`Arquivo carregado (${conteudo.length} chars). Revise e importe.`);
    } catch (e) {
      setErro(String(e));
    }
  }

  /** Parseia o texto atual e persiste como nova colecao via IPC. */
  async function importar() {
    limparMensagens();
    const cru = texto.trim();
    if (!cru) {
      setErro("Cole o conteudo ou escolha um arquivo primeiro.");
      return;
    }
    const resultado = parserDe(formato)(cru);
    if (!resultado.ok) {
      setErro(resultado.error);
      return;
    }
    setBusy(true);
    try {
      const path = await persistirImportado(resultado.collection);
      await openCollection(path);
      setInfo(`Colecao "${resultado.collection.name}" importada.`);
      setTexto("");
      if (onImported) await onImported(path);
    } catch (e) {
      setErro(`Falha ao gravar colecao: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Exporta a colecao ativa para um arquivo Postman v2.1. */
  async function exportar() {
    limparMensagens();
    const col: Collection | undefined = activePath
      ? collections[activePath]
      : undefined;
    if (!col) {
      setErro("Nenhuma colecao ativa para exportar.");
      return;
    }
    setBusy(true);
    try {
      const json = paraPostmanString(col);
      const destino = await saveDialog({
        defaultPath: `${col.name || "colecao"}.postman_collection.json`,
        filters: [{ name: "Postman", extensions: ["json"] }],
      });
      if (!destino) {
        setBusy(false);
        return;
      }
      await writeTextFile(destino, json);
      setInfo(`Exportado para ${destino}`);
    } catch (e) {
      setErro(`Falha ao exportar: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={estilos.painel}>
      <div style={estilos.titulo}>Importar</div>
      <div style={estilos.linha}>
        <select
          style={estilos.select}
          aria-label="Formato de import"
          value={formato}
          onChange={(e) => setFormato(e.target.value as Formato)}
          disabled={busy}
        >
          {FORMATOS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={estilos.botao}
          onClick={() => void escolherArquivo()}
          disabled={busy}
        >
          Escolher arquivo
        </button>
        <button
          type="button"
          style={estilos.botao}
          onClick={() => void importar()}
          disabled={busy || texto.trim().length === 0}
        >
          Importar
        </button>
      </div>
      <textarea
        style={estilos.textarea}
        aria-label="Conteudo para importar"
        placeholder={
          formato === "curl"
            ? "Cole um comando cURL..."
            : "Cole o JSON da colecao/spec ou escolha um arquivo..."
        }
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        disabled={busy}
      />

      <div style={estilos.titulo}>Exportar</div>
      <div style={estilos.linha}>
        <button
          type="button"
          style={estilos.botao}
          onClick={() => void exportar()}
          disabled={busy || !activePath}
        >
          Exportar colecao ativa (Postman v2.1)
        </button>
      </div>

      {erro ? (
        <div style={estilos.erro} role="alert">
          {erro}
        </div>
      ) : null}
      {info ? <div style={estilos.msg}>{info}</div> : null}
    </div>
  );
}

/**
 * Persiste uma colecao importada usando os comandos existentes. Cria a colecao
 * (na pasta escolhida pelo usuario) e executa o plano de persistencia (pastas e
 * requests) em ordem. Retorna o caminho da colecao criada.
 *
 * NAO e puro (faz IPC); a logica pura (achatar a arvore, derivar `dir`) vive em
 * planoDePersistencia (src/lib/export.ts), testada isoladamente.
 */
async function persistirImportado(imported: ImportResult): Promise<string> {
  const parent = await escolherPastaDestino();
  if (!parent) {
    throw new Error("Import cancelado (nenhuma pasta destino).");
  }

  // create_collection devolve a Collection carregada, mas nao o caminho; o
  // backend cria <parent>/<slug(name)>/. Reconstruimos o caminho com a mesma
  // regra de slug do backend (slugSeguro) — ja usado em planoDePersistencia.
  await ipcCreateCollection(parent, imported.name);
  const path = `${parent.replace(/\/$/, "")}/${slugDoNome(imported.name)}`;

  const ops: OpPersistencia[] = planoDePersistencia(imported.items);
  for (const op of ops) {
    if (op.tipo === "pasta") {
      await createFolder(path, op.name, op.seq, op.dir);
    } else {
      await saveRequest(path, op.request, op.dir);
    }
  }

  return path;
}

/** Slug local (re-exposto via export.ts) para reconstruir o caminho. */
function slugDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Abre o dialog de diretorio para escolher onde gravar a colecao. */
async function escolherPastaDestino(): Promise<string | null> {
  const sel = await openDialog({ directory: true, multiple: false });
  return Array.isArray(sel) ? (sel[0] ?? null) : sel;
}

export default ImportExportPanel;
