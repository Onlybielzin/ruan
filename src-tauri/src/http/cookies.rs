// F14 — Cookie jar compartilhado entre requests.
//
// Mantemos um `reqwest::cookie::Jar` unico (Arc) no estado Tauri (.manage). O
// Client da engine usa esse jar como cookie_provider, entao Set-Cookie de uma
// resposta passa a ser reenviado (Cookie:) nas proximas requests do mesmo
// dominio — comportamento de "sessao" esperado de um cliente HTTP.
//
// REGISTRAR NO lib.rs (fase de Integracao):
//   .manage(http::cookies::CookieJarState::new())
//   http::cookies::list_cookies,
//   http::cookies::clear_cookies,
//   http::cookies::set_cookies_enabled,
//   http::cookies::cookies_enabled,
//
// Toggle on/off: um AtomicBool no estado (default ON) decide se a engine injeta
// o jar. Desligado, o Client roda sem cookie store (cada request limpa de
// cookies de sessao). Limpar/listar continuam funcionando sobre o jar guardado.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use reqwest::cookie::{CookieStore, Jar};
use reqwest::Url;
use serde::{Deserialize, Serialize};

/// Estado gerenciado pelo Tauri: o jar compartilhado + flag de ligado/desligado.
/// O jar fica atras de um `RwLock` para permitir limpeza in-place (trocar o
/// `Arc<Jar>` interno por um vazio) — o mesmo `State` gerenciado passa a apontar
/// pro jar novo nas proximas requests. Clonar o `Arc<Jar>` da o mesmo store; o
/// `enabled` controla se a engine o usa.
pub struct CookieJarState {
    jar: RwLock<Arc<Jar>>,
    enabled: AtomicBool,
}

impl CookieJarState {
    /// Cria um estado novo com jar vazio e cookies LIGADOS por padrao.
    pub fn new() -> Self {
        Self {
            jar: RwLock::new(Arc::new(Jar::default())),
            enabled: AtomicBool::new(true),
        }
    }

    /// Handle clonavel do jar (mesmo store por baixo). A engine passa isto pro
    /// Client via `.cookie_provider(...)`.
    pub fn jar(&self) -> Arc<Jar> {
        self.jar
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|p| p.into_inner().clone())
    }

    /// Limpa TODOS os cookies guardados, trocando o jar interno por um vazio
    /// in-place. O proximo envio (que chama `jar_para_envio()` no mesmo `State`)
    /// ja pega o jar vazio — diferente de tentar `.manage` um estado novo (que
    /// em Tauri v2 e no-op se o tipo ja esta gerenciado).
    pub fn clear(&self) {
        let novo = Arc::new(Jar::default());
        match self.jar.write() {
            Ok(mut g) => *g = novo,
            Err(p) => *p.into_inner() = novo,
        }
    }

    /// True se a injecao do jar esta ligada (default). LOGICA PURA (le o atomic).
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Liga/desliga a injecao do jar na engine. NAO apaga cookies ja guardados.
    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Relaxed);
    }

    /// Jar a usar no envio: `Some(jar)` se ligado, `None` se desligado. A engine
    /// so injeta cookie_provider quando recebe Some. LOGICA PURA.
    pub fn jar_para_envio(&self) -> Option<Arc<Jar>> {
        if self.is_enabled() {
            Some(self.jar())
        } else {
            None
        }
    }
}

impl Default for CookieJarState {
    fn default() -> Self {
        Self::new()
    }
}

/// Um cookie exposto ao front (sem expiracao/raw — so o util pra UI de gestao).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieInfo {
    pub dominio: String,
    pub nome: String,
    pub valor: String,
    pub path: String,
    pub secure: bool,
}

// O `reqwest::cookie::Jar` nao expõe iteracao dos cookies guardados; ele so
// responde "quais cookies mandar pra esta URL" (via CookieStore::cookies). Para
// listar/limpar por dominio mantemos um indice paralelo das URLs que ja
// receberam Set-Cookie e consultamos o jar por elas. Esse indice vive no front?
// Nao: para manter o backend a fonte da verdade e o contrato simples, a F14
// parseia os cookies a partir do header `cookie` que o jar produz para cada URL
// conhecida. Como nao temos as URLs, derivamos `CookieInfo` parseando o header
// `Cookie` devolvido pelo jar para um conjunto de URLs candidatas registradas.
//
// Para evitar dependencia de detalhes internos do Jar, expomos helpers PUROS de
// parsing que sao o alvo testavel, e a parte de I/O (consultar o jar) fica fina.

/// Faz parsing de um header `Cookie` ("a=1; b=2") em pares (nome,valor).
/// LOGICA PURA. Ignora segmentos vazios e sem '='. Trim em nome e valor.
pub fn parse_cookie_header(header: &str) -> Vec<(String, String)> {
    header
        .split(';')
        .filter_map(|seg| {
            let seg = seg.trim();
            if seg.is_empty() {
                return None;
            }
            let (nome, valor) = seg.split_once('=')?;
            let nome = nome.trim();
            if nome.is_empty() {
                return None;
            }
            Some((nome.to_string(), valor.trim().to_string()))
        })
        .collect()
}

/// True se `dominio_cookie` casa o filtro `alvo` (sub-string case-insensitive do
/// host). `alvo` None/"" casa tudo. LOGICA PURA — usada por list/clear.
pub fn dominio_casa(dominio_cookie: &str, alvo: Option<&str>) -> bool {
    match alvo {
        None => true,
        Some(a) => {
            let a = a.trim();
            a.is_empty() || dominio_cookie.to_lowercase().contains(&a.to_lowercase())
        }
    }
}

/// Monta os `CookieInfo` para uma URL, consultando o `Jar` (que devolve o header
/// `Cookie` aplicavel aquela URL) e parseando-o. `secure`/`path` derivam da URL
/// consultada (o Jar nao reexpoe esses atributos por cookie). LOGICA quase pura
/// (recebe o jar e a url ja prontos).
pub fn cookies_para_url(jar: &Jar, url: &Url) -> Vec<CookieInfo> {
    let header = jar
        .cookies(url)
        .and_then(|hv| hv.to_str().ok().map(|s| s.to_string()))
        .unwrap_or_default();
    let dominio = url.host_str().unwrap_or("").to_string();
    let path = url.path().to_string();
    let secure = url.scheme() == "https";
    parse_cookie_header(&header)
        .into_iter()
        .map(|(nome, valor)| CookieInfo {
            dominio: dominio.clone(),
            nome,
            valor,
            path: path.clone(),
            secure,
        })
        .collect()
}

// ---- Comandos Tauri -------------------------------------------------------
//
// Como o Jar do reqwest nao itera cookies por conta propria, a listagem exige
// as URLs/dominios de interesse. O front mantem a lista de dominios "vistos"
// (das respostas) e os passa aqui. Assim o contrato fica explicito e o backend
// nao precisa de um indice mutavel paralelo (menos estado, menos bug).

/// Decide se `c` deve entrar em `out`: passa pelo filtro de dominio E nao e
/// duplicata (mesmo nome+dominio) de algo ja acumulado. Se sim, faz o push e
/// devolve true. LOGICA PURA — extraida de `list_cookies` para ser testavel sem
/// montar o estado Tauri/jar.
pub fn acumular_cookie(
    out: &mut Vec<CookieInfo>,
    c: CookieInfo,
    filtro: Option<&str>,
) -> bool {
    if !dominio_casa(&c.dominio, filtro) {
        return false;
    }
    let duplicado = out
        .iter()
        .any(|j| j.nome == c.nome && j.dominio == c.dominio);
    if duplicado {
        return false;
    }
    out.push(c);
    true
}

/// Lista os cookies guardados para os `dominios` informados (https assumido).
/// Cada dominio vira uma URL https://dominio/ consultada no jar.
#[tauri::command]
pub fn list_cookies(
    estado: tauri::State<'_, CookieJarState>,
    dominios: Vec<String>,
    filtro: Option<String>,
) -> Vec<CookieInfo> {
    let jar = estado.jar();
    let mut out = Vec::new();
    for d in dominios {
        let d = d.trim();
        if d.is_empty() {
            continue;
        }
        // Tenta https e http (cookies secure vs nao-secure).
        for scheme in ["https", "http"] {
            if let Ok(url) = Url::parse(&format!("{scheme}://{d}/")) {
                for c in cookies_para_url(&jar, &url) {
                    acumular_cookie(&mut out, c, filtro.as_deref());
                }
            }
        }
    }
    out
}

/// Limpa cookies. Como o Jar do reqwest nao apaga seletivamente, "limpar" troca
/// o store interno por um novo (vazio) IN-PLACE no mesmo estado gerenciado. Por
/// isso clear SEMPRE limpa tudo; o parametro `dominio` fica para compat futura
/// (quando trocarmos o store por um que itere).
///
/// NOTA DE SEGURANCA/HONESTIDADE: como o Jar nao suporta remocao por dominio, um
/// clear por dominio NAO e possivel sem trocar a impl do store. Para nao mentir
/// pro usuario, a UI deve deixar claro que limpar afeta todos os cookies; este
/// comando devolve `false` quando pediram um dominio (nada foi feito seletivo) e
/// `true` quando limpou tudo. Em ambos os casos o jar inteiro e esvaziado.
#[tauri::command]
pub fn clear_cookies(
    estado: tauri::State<'_, CookieJarState>,
    dominio: Option<String>,
) -> bool {
    // Esvazia o jar in-place (preserva o flag enabled, que vive no mesmo estado).
    estado.clear();
    // Se pediram dominio especifico, sinalizamos que foi um clear total mesmo
    // assim (limitacao do Jar) devolvendo false; ainda assim limpamos tudo.
    let seletivo = dominio.as_deref().map(|d| !d.trim().is_empty()).unwrap_or(false);
    !seletivo
}

/// Liga/desliga a injecao do cookie jar na engine. Persistencia: so em memoria
/// (vale pela sessao). Retorna o novo estado.
#[tauri::command]
pub fn set_cookies_enabled(estado: tauri::State<'_, CookieJarState>, on: bool) -> bool {
    estado.set_enabled(on);
    estado.is_enabled()
}

/// Le se o cookie jar esta ligado.
#[tauri::command]
pub fn cookies_enabled(estado: tauri::State<'_, CookieJarState>) -> bool {
    estado.is_enabled()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- parse_cookie_header --------------------------------------------

    #[test]
    fn parse_um_par() {
        assert_eq!(
            parse_cookie_header("a=1"),
            vec![("a".to_string(), "1".to_string())]
        );
    }

    #[test]
    fn parse_multiplos_pares() {
        assert_eq!(
            parse_cookie_header("a=1; b=2"),
            vec![
                ("a".to_string(), "1".to_string()),
                ("b".to_string(), "2".to_string())
            ]
        );
    }

    #[test]
    fn parse_trim_em_nome_e_valor() {
        assert_eq!(
            parse_cookie_header("  a  =  1  ;  b=2 "),
            vec![
                ("a".to_string(), "1".to_string()),
                ("b".to_string(), "2".to_string())
            ]
        );
    }

    #[test]
    fn parse_ignora_segmento_vazio() {
        assert_eq!(
            parse_cookie_header("a=1;; ;b=2"),
            vec![
                ("a".to_string(), "1".to_string()),
                ("b".to_string(), "2".to_string())
            ]
        );
    }

    #[test]
    fn parse_ignora_sem_igual() {
        assert_eq!(
            parse_cookie_header("a=1; lixo; b=2"),
            vec![
                ("a".to_string(), "1".to_string()),
                ("b".to_string(), "2".to_string())
            ]
        );
    }

    #[test]
    fn parse_ignora_nome_vazio() {
        assert_eq!(parse_cookie_header("=1; a=2"), vec![("a".to_string(), "2".to_string())]);
    }

    #[test]
    fn parse_valor_vazio_ok() {
        assert_eq!(
            parse_cookie_header("a="),
            vec![("a".to_string(), "".to_string())]
        );
    }

    #[test]
    fn parse_valor_com_igual_interno() {
        // split_once no primeiro '=' — valor pode conter '='.
        assert_eq!(
            parse_cookie_header("tok=a=b=c"),
            vec![("tok".to_string(), "a=b=c".to_string())]
        );
    }

    #[test]
    fn parse_header_vazio() {
        assert!(parse_cookie_header("").is_empty());
    }

    #[test]
    fn parse_so_espacos() {
        assert!(parse_cookie_header("   ").is_empty());
    }

    #[test]
    fn parse_so_separadores() {
        assert!(parse_cookie_header(";;;").is_empty());
    }

    // ---- dominio_casa ---------------------------------------------------

    #[test]
    fn dominio_casa_none_casa_tudo() {
        assert!(dominio_casa("x.test", None));
    }

    #[test]
    fn dominio_casa_vazio_casa_tudo() {
        assert!(dominio_casa("x.test", Some("")));
        assert!(dominio_casa("x.test", Some("   ")));
    }

    #[test]
    fn dominio_casa_substring() {
        assert!(dominio_casa("api.x.test", Some("x.test")));
        assert!(dominio_casa("api.x.test", Some("api")));
    }

    #[test]
    fn dominio_casa_case_insensitive() {
        assert!(dominio_casa("API.X.Test", Some("x.test")));
        assert!(dominio_casa("api.x.test", Some("X.TEST")));
    }

    #[test]
    fn dominio_casa_nao_casa() {
        assert!(!dominio_casa("x.test", Some("y.other")));
    }

    #[test]
    fn dominio_casa_trim_no_alvo() {
        assert!(dominio_casa("api.x.test", Some("  x.test  ")));
    }

    // ---- CookieJarState toggle ------------------------------------------

    #[test]
    fn estado_default_ligado() {
        let s = CookieJarState::new();
        assert!(s.is_enabled());
    }

    #[test]
    fn estado_toggle_desliga_e_liga() {
        let s = CookieJarState::new();
        s.set_enabled(false);
        assert!(!s.is_enabled());
        s.set_enabled(true);
        assert!(s.is_enabled());
    }

    #[test]
    fn jar_para_envio_some_quando_ligado() {
        let s = CookieJarState::new();
        assert!(s.jar_para_envio().is_some());
    }

    #[test]
    fn jar_para_envio_none_quando_desligado() {
        let s = CookieJarState::new();
        s.set_enabled(false);
        assert!(s.jar_para_envio().is_none());
    }

    #[test]
    fn jar_mesmo_store_em_clones() {
        // Dois handles do mesmo estado apontam pro mesmo Arc.
        let s = CookieJarState::new();
        let a = s.jar();
        let b = s.jar();
        assert!(Arc::ptr_eq(&a, &b));
    }

    #[test]
    fn clear_esvazia_o_jar_in_place() {
        // F14 [ALTO]: clear deve realmente apagar os cookies guardados, no MESMO
        // estado gerenciado (sem depender de `.manage` de um tipo novo).
        let s = CookieJarState::new();
        let url = Url::parse("https://x.test/").unwrap();
        s.jar().add_cookie_str("sid=abc", &url);
        assert_eq!(cookies_para_url(&s.jar(), &url).len(), 1);

        s.clear();
        // O proximo envio (jar_para_envio) pega o jar novo, vazio.
        let jar_apos = s.jar_para_envio().expect("ligado por padrao");
        assert!(cookies_para_url(&jar_apos, &url).is_empty());
        // E uma leitura direta do jar atual tambem ja reflete o esvaziamento.
        assert!(cookies_para_url(&s.jar(), &url).is_empty());
    }

    #[test]
    fn clear_preserva_o_flag_enabled() {
        // clear nao mexe no toggle (que vive no mesmo estado).
        let s = CookieJarState::new();
        s.set_enabled(false);
        s.clear();
        assert!(!s.is_enabled());
        assert!(s.jar_para_envio().is_none());
    }

    #[test]
    fn clear_troca_o_arc_interno() {
        // Apos clear, o Arc devolvido e DIFERENTE do anterior (store novo).
        let s = CookieJarState::new();
        let antes = s.jar();
        s.clear();
        let depois = s.jar();
        assert!(!Arc::ptr_eq(&antes, &depois));
    }

    // ---- cookies_para_url + jar real ------------------------------------

    #[test]
    fn cookies_para_url_le_do_jar() {
        let jar = Jar::default();
        let url = Url::parse("https://x.test/").unwrap();
        jar.add_cookie_str("sid=abc; Path=/", &url);
        let cs = cookies_para_url(&jar, &url);
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].nome, "sid");
        assert_eq!(cs[0].valor, "abc");
        assert_eq!(cs[0].dominio, "x.test");
        assert!(cs[0].secure); // https
    }

    #[test]
    fn cookies_para_url_http_nao_secure() {
        let jar = Jar::default();
        let url = Url::parse("http://x.test/").unwrap();
        jar.add_cookie_str("a=1", &url);
        let cs = cookies_para_url(&jar, &url);
        assert_eq!(cs.len(), 1);
        assert!(!cs[0].secure);
    }

    #[test]
    fn cookies_para_url_jar_vazio_lista_vazia() {
        let jar = Jar::default();
        let url = Url::parse("https://vazio.test/").unwrap();
        assert!(cookies_para_url(&jar, &url).is_empty());
    }

    #[test]
    fn cookies_para_url_multiplos_cookies() {
        let jar = Jar::default();
        let url = Url::parse("https://x.test/").unwrap();
        jar.add_cookie_str("a=1", &url);
        jar.add_cookie_str("b=2", &url);
        let cs = cookies_para_url(&jar, &url);
        let nomes: Vec<&str> = cs.iter().map(|c| c.nome.as_str()).collect();
        assert!(nomes.contains(&"a"));
        assert!(nomes.contains(&"b"));
    }

    // ---- acumular_cookie ------------------------------------------------

    fn ci(nome: &str, dominio: &str) -> CookieInfo {
        CookieInfo {
            dominio: dominio.to_string(),
            nome: nome.to_string(),
            valor: "v".to_string(),
            path: "/".to_string(),
            secure: false,
        }
    }

    #[test]
    fn acumular_push_quando_novo_e_casa_filtro() {
        let mut out = vec![];
        assert!(acumular_cookie(&mut out, ci("a", "x.test"), None));
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn acumular_rejeita_fora_do_filtro() {
        let mut out = vec![];
        assert!(!acumular_cookie(&mut out, ci("a", "x.test"), Some("y.other")));
        assert!(out.is_empty());
    }

    #[test]
    fn acumular_dedup_mesmo_nome_e_dominio() {
        let mut out = vec![ci("a", "x.test")];
        assert!(!acumular_cookie(&mut out, ci("a", "x.test"), None));
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn acumular_mesmo_nome_dominio_diferente_entra() {
        let mut out = vec![ci("a", "x.test")];
        assert!(acumular_cookie(&mut out, ci("a", "y.test"), None));
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn acumular_dominio_igual_nome_diferente_entra() {
        let mut out = vec![ci("a", "x.test")];
        assert!(acumular_cookie(&mut out, ci("b", "x.test"), None));
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn acumular_filtro_aplica_substring() {
        let mut out = vec![];
        // casa o filtro (substring) -> entra
        assert!(acumular_cookie(&mut out, ci("a", "api.x.test"), Some("x.test")));
        assert_eq!(out.len(), 1);
    }

    // ---- CookieInfo serde -----------------------------------------------

    #[test]
    fn cookieinfo_serializa_camelcase() {
        let c = CookieInfo {
            dominio: "x.test".to_string(),
            nome: "sid".to_string(),
            valor: "abc".to_string(),
            path: "/".to_string(),
            secure: true,
        };
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["dominio"], "x.test");
        assert_eq!(json["nome"], "sid");
        assert_eq!(json["valor"], "abc");
        assert_eq!(json["path"], "/");
        assert_eq!(json["secure"], true);
    }
}
