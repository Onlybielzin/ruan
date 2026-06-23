// Store Zustand da request em edicao + envio (F4). Os paineis das features
// F5 (params/headers), F6 (body) e F7 (auth) plugam aqui via `atualizarRequest`
// (patch generico), sem precisar editar este store.

import { create } from "zustand";
import type { RequestItem } from "../lib/types";
import { novaRequest } from "../lib/types";
import type { ResponseData } from "../lib/http-types";
import { requestDataDeItem, mensagemDeErro } from "../lib/http-types";
import { sendRequest } from "../lib/sendClient";

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

  atualizarRequest: (patch) => {
    set((state) => ({ request: { ...state.request, ...patch } }));
  },

  setRequest: (request) => {
    set({ request, response: null, error: null });
  },

  enviar: async () => {
    // Evita envios concorrentes do mesmo store.
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const req = requestDataDeItem(get().request);
      const response = await sendRequest(req);
      set({ response, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: mensagemDeErro(e) });
    }
  },

  limparResposta: () => {
    set({ response: null, error: null });
  },
}));
