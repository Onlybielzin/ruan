// Store Zustand da request em edicao + envio (F4). Os paineis das features
// F5 (params/headers), F6 (body) e F7 (auth) plugam aqui via `atualizarRequest`
// (patch generico), sem precisar editar este store.

import { create } from "zustand";
import type { RequestItem } from "../lib/types";
import { novaRequest, normalizarRequest } from "../lib/types";
import type { ResponseData } from "../lib/http-types";
import { requestDataDeItem, mensagemDeErro } from "../lib/http-types";
import { sendRequest } from "../lib/sendClient";
import { interpolarRequest } from "../lib/interpolation";
import {
  resolverAuthEfetiva,
  aplicarAuth,
  mesclarSemSobrescrever,
} from "../lib/auth";
import { useEnvStore } from "./envStore";
import { useCollectionsStore } from "./collectionsStore";
import { runScript, montarRuan } from "../lib/scripting";
import type { RuanApi } from "../lib/scripting";

interface RequestState {
  /** Request atualmente em edicao no builder. */
  request: RequestItem;
  /** Ultima resposta recebida (null antes do primeiro envio). */
  response: ResponseData | null;
  /** True enquanto um envio esta em andamento. */
  loading: boolean;
  /** Mensagem do ultimo erro de envio (null se ok). */
  error: string | null;
  /**
   * Nomes de variaveis `{{var}}` que NAO resolveram no ultimo envio (so NOMES,
   * nunca valores — vars secret nao vazam aqui). A UI mostra como aviso nao
   * bloqueante. Vazio = tudo resolvido.
   */
  avisoVars: string[];
  /**
   * Logs capturados (console.*) dos scripts pre/post do ultimo envio, na ordem
   * de execucao (pre primeiro, depois post). A UI mostra no ScriptConsole.
   */
  scriptLogs: string[];
  /**
   * Mensagem de erro do ultimo script que lancou (pre ou post), ou null se
   * ambos rodaram ok / nao havia script. NAO bloqueia o envio.
   */
  scriptErro: string | null;

  /**
   * Aplica um patch parcial na request atual. Generico de proposito: qualquer
   * painel (metodo, url, headers, params, body, auth...) usa isto.
   */
  atualizarRequest: (patch: Partial<RequestItem>) => void;
  /** Substitui a request inteira (ex: ao selecionar outra na arvore). */
  setRequest: (request: RequestItem) => void;
  /** Dispara a request atual e guarda resposta/erro/loading. */
  enviar: () => Promise<void>;
  /** Limpa a resposta/erro (ex: ao trocar de request). */
  limparResposta: () => void;
}

export const useRequestStore = create<RequestState>((set, get) => ({
  request: novaRequest("Nova Request"),
  response: null,
  loading: false,
  error: null,
  avisoVars: [],
  scriptLogs: [],
  scriptErro: null,

  atualizarRequest: (patch) => {
    set((state) => ({ request: { ...state.request, ...patch } }));
  },

  setRequest: (request) => {
    // Normaliza na costura IPC: a request vinda da arvore pode ter headers/params/
    // body.form omitidos pelo serde do backend. Sem isso, os paineis quebram ao
    // iterar (undefined.map) e a tela fica preta ao selecionar uma request.
    set({
      request: normalizarRequest(request),
      response: null,
      error: null,
      avisoVars: [],
      scriptLogs: [],
      scriptErro: null,
    });
  },

  enviar: async () => {
    // Evita envios concorrentes do mesmo store.
    if (get().loading) return;
    set({ loading: true, error: null, scriptLogs: [], scriptErro: null });
    // Buffer acumulado de logs/erro dos scripts (pre + post). Guardado no estado
    // ao final (e tambem no catch, para nao perder logs do pre se o envio falhar).
    const scriptLogs: string[] = [];
    let scriptErro: string | null = null;
    try {
      const collectionsState = useCollectionsStore.getState();
      const activePath = collectionsState.activePath;

      // Objeto `ruan` ligado ao envStore da colecao ativa. Sem colecao ativa,
      // setVar/setEnvVar viram no-op (e getVar/getEnvVar retornam undefined).
      const ruan = montarRuanParaColecao(activePath);

      // (1) PRE-script: roda ANTES da interpolacao com `req` MUTAVEL. O usuario
      // pode mutar method/url/headers/params/body e setar vars (que afetam a
      // interpolacao subsequente, pois rodamos scopesDe DEPOIS do pre).
      const reqMutavel = requestDataDeItem(get().request);
      const pre = runScript(get().request.scripts.pre, {
        ruan,
        req: reqMutavel,
      });
      for (const l of pre.logs) scriptLogs.push(l);
      if (pre.erro) scriptErro = `pre: ${pre.erro}`;

      // (2) Monta os escopos JA com as vars que o pre-script setou e interpola
      // `{{var}}`. O Rust so executa HTTP; a resolucao e do front (decisao M2).
      const scopes = useEnvStore.getState().scopesDe(activePath);
      const { req, faltando } = interpolarRequest(reqMutavel, scopes);
      // `faltando` NAO bloqueia o envio: guarda apenas NOMES para aviso na UI.

      // F11 — resolve a auth EFETIVA (heranca request -> pasta -> colecao) e
      // mescla os headers/query produzidos. A auth da colecao ativa e o topo da
      // cadeia de `mode: 'inherit'`. A auth de PASTA depende de um breadcrumb da
      // request ativa que este store ainda nao rastreia; quando disponivel, a
      // Integracao pode passar `folderAuth` em vez de undefined. Os campos de
      // auth sao interpolados em `aplicarAuth` (reusa a F10) antes de virar
      // headers/query. A mescla NAO sobrescreve o que o usuario definiu na mao.
      const colecaoAtiva = activePath
        ? collectionsState.collections[activePath]
        : undefined;
      const authEfetiva = resolverAuthEfetiva(
        get().request.auth,
        undefined,
        colecaoAtiva?.auth,
      );
      const aplicada = aplicarAuth(authEfetiva, scopes);
      // Projeta os pares de auth no shape enxuto KeyVal do envio (name/value/
      // enabled), descartando `description` que o envio nao usa.
      const authHeaders = aplicada.headers.map((h) => ({
        name: h.name,
        value: h.value,
        enabled: h.enabled,
      }));
      const authQuery = aplicada.query.map((q) => ({
        name: q.name,
        value: q.value,
        enabled: q.enabled,
      }));
      const reqComAuth = {
        ...req,
        // Nao sobrescreve headers/params que o usuario ja definiu na mao.
        headers: mesclarSemSobrescrever(req.headers, authHeaders, true),
        params: mesclarSemSobrescrever(req.params, authQuery, false),
      };

      const response = await sendRequest(reqComAuth);

      // (5) POST-script: acesso a `res` (ResponseData) e pode setar vars (ex:
      // extrair um token do corpo). `req` continua disponivel (ja interpolado).
      const post = runScript(get().request.scripts.post, {
        ruan,
        req,
        res: response,
      });
      for (const l of post.logs) scriptLogs.push(l);
      if (post.erro) {
        scriptErro = scriptErro
          ? `${scriptErro}; post: ${post.erro}`
          : `post: ${post.erro}`;
      }

      set({
        response,
        loading: false,
        error: null,
        avisoVars: faltando,
        scriptLogs,
        scriptErro,
      });
    } catch (e) {
      // Mantem os logs/erro do pre-script mesmo se o envio HTTP falhar.
      set({
        loading: false,
        error: mensagemDeErro(e),
        scriptLogs,
        scriptErro,
      });
    }
  },

  limparResposta: () => {
    set({
      response: null,
      error: null,
      avisoVars: [],
      scriptLogs: [],
      scriptErro: null,
    });
  },
}));

/**
 * Liga o objeto `ruan` exposto aos scripts ao envStore da colecao ativa.
 *   getVar/setVar      -> runtime vars (sessao)
 *   getEnvVar/setEnvVar -> environment ativo (persiste no disco)
 * Sem colecao ativa (`path === null`), leituras retornam undefined e escritas
 * sao no-op (nao ha onde guardar).
 */
function montarRuanParaColecao(path: string | null): RuanApi {
  if (path === null) {
    return {
      getVar: () => undefined,
      setVar: () => {},
      getEnvVar: () => undefined,
      setEnvVar: () => {},
    };
  }
  const env = useEnvStore.getState();
  return montarRuan({
    getVar: (nome) => env.getRuntimeVar(path, nome),
    setVar: (nome, valor) => env.setRuntimeVar(path, nome, valor),
    getEnvVar: (nome) => env.getEnvVarAtiva(path, nome),
    // setEnvVar e async (persiste no disco); o script nao aguarda — disparamos
    // e seguimos (a persistencia roda em background, o estado em memoria ja
    // reflete via salvarEnvironment).
    setEnvVar: (nome, valor) => {
      void env.setEnvVarAtiva(path, nome, valor);
    },
  });
}
