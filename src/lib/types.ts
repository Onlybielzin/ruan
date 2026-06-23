// Espelho TS do schema Rust (src-tauri/src/store/models.rs).
// Mantenha sincronizado: serde usa camelCase no disco e no IPC, entao os campos
// aqui batem 1:1 com as structs Rust.

/** Par chave/valor (headers, params, form data). */
export interface KeyValue {
  name: string;
  value: string;
  /** Se false, o par existe no arquivo mas nao e enviado. */
  enabled: boolean;
  description?: string;
}

/** Modo do corpo da request (snake_case, igual ao serde do Rust). */
export type BodyMode =
  | "none"
  | "json"
  | "text"
  | "xml"
  | "form_urlencoded"
  | "multipart"
  | "graphql";

export interface GraphqlBody {
  query: string;
  /** Variables como string JSON. */
  variables: string;
}

export interface Body {
  mode: BodyMode;
  /** Texto cru para json/text/xml. */
  raw?: string;
  /** Pares para form_urlencoded e multipart. */
  form?: KeyValue[];
  graphql?: GraphqlBody;
}

/** Modo de autenticacao (extensivel em M2). */
export type AuthMode =
  | "none"
  | "inherit"
  | "basic"
  | "bearer"
  | "apikey"
  | "oauth2";

export type ApiKeyPlacement = "header" | "query";

export interface Auth {
  mode: AuthMode;
  // basic
  username?: string;
  password?: string;
  // bearer
  token?: string;
  // apikey
  key?: string;
  value?: string;
  placement?: ApiKeyPlacement;
}

export interface Scripts {
  pre: string;
  post: string;
}

/** Uma request HTTP individual (gravada em <slug>.yml). */
export interface RequestItem {
  name: string;
  /** Ordem de exibicao dentro da pasta/colecao. */
  seq: number;
  method: string;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: Body;
  auth: Auth;
  scripts: Scripts;
  /** Conteudo cru dos testes (execucao e do M3). */
  tests: string;
  /** Documentacao em markdown. */
  docs: string;
}

/** Pasta da colecao (diretorio com folder.yml). */
export interface Folder {
  name: string;
  seq: number;
  items: TreeItem[];
}

/**
 * No da arvore: pasta ou request. Discriminado por `type`, igual ao serde
 * `#[serde(tag = "type")]` do Rust (folder | request).
 */
export type TreeItem =
  | ({ type: "folder" } & Folder)
  | ({ type: "request" } & RequestItem);

/** Config raiz da colecao (collection.yml + arvore reconstruida do disco). */
export interface Collection {
  name: string;
  version: string;
  items: TreeItem[];
  /** Variaveis da colecao — campo aberto para o M2. */
  vars?: unknown;
}

/** Type guards para discriminar TreeItem. */
export function isFolder(
  item: TreeItem,
): item is { type: "folder" } & Folder {
  return item.type === "folder";
}

export function isRequest(
  item: TreeItem,
): item is { type: "request" } & RequestItem {
  return item.type === "request";
}

/** Cria uma RequestItem padrao (GET vazia) com o nome dado. */
export function novaRequest(name: string, seq = 0): RequestItem {
  return {
    name,
    seq,
    method: "GET",
    url: "",
    headers: [],
    params: [],
    body: { mode: "none" },
    auth: { mode: "none" },
    scripts: { pre: "", post: "" },
    tests: "",
    docs: "",
  };
}
