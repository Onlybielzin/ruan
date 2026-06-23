// Tipos da engine HTTP, serializaveis pro IPC (espelho em src/lib/http-types.ts).
// camelCase no IPC, igual ao resto do projeto.

use serde::{Deserialize, Serialize, Serializer};
use thiserror::Error;

/// Par chave/valor simples para headers/params no envio. Espelha o subset
/// relevante de store::models::KeyValue (so o que a engine precisa: name/value/
/// enabled). O front converte RequestItem -> RequestData filtrando desabilitados,
/// mas a engine tambem respeita `enabled` por seguranca/defesa-em-profundidade.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyVal {
    pub name: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Corpo da request no envio. Enxuto de proposito: a F4 cobre os modos basicos
/// (none/text-like/form). multipart/graphql sao tratados por features futuras;
/// aqui `raw` cobre json/text/xml (o content-type vem dos headers ou e default).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestBody {
    /// Modo do corpo. Strings snake_case iguais ao BodyMode do store.
    #[serde(default)]
    pub mode: String,
    /// Texto cru (json/text/xml). Ignorado se vazio/None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    /// Pares para form_urlencoded.
    #[serde(default)]
    pub form: Vec<KeyVal>,
}

/// Request a ser enviada. Montada pelo front a partir do RequestItem do store.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestData {
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: Vec<KeyVal>,
    /// Query params adicionados a URL (alem dos que ja vierem na url string).
    #[serde(default)]
    pub params: Vec<KeyVal>,
    #[serde(default)]
    pub body: RequestBody,
    /// Timeout em milissegundos. None => default (30s).
    /// Compat F4. Se `settings.timeout_ms` estiver presente, ELE tem precedencia
    /// (a F20 compoe o timeout efetivo no front e o entrega em `settings`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    /// Config efetiva de envio (F20). None => comportamento legado (timeout do
    /// campo acima/default, redirects ate 10, sem proxy, SSL verificado).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<RequestSettings>,
}

fn default_method() -> String {
    "GET".to_string()
}

/// Config efetiva de envio entregue pela F20 (espelha EffectiveSettings do TS).
/// Todos os campos opcionais por retrocompat: serde `default` preenche ausentes,
/// e o front so manda o que resolveu. A engine aplica o que estiver presente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestSettings {
    /// URL do proxy (http/https/socks). Ausente => sem proxy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    /// Verificar certificado SSL. None => default (verifica).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl_verify: Option<bool>,
    /// Timeout em ms. None => cai no timeout_ms do RequestData/default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    /// Seguir redirects (3xx). None => default (segue, ate o limite do reqwest).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_redirects: Option<bool>,
    /// Maximo de redirects (so vale com follow_redirects=true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_redirects: Option<u64>,
    /// Percent-encode automatico da URL. Reservado (a montagem ja encoda params).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encode_url: Option<bool>,
}

/// Resposta estruturada devolvida ao front.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    /// Headers da resposta como lista (preserva duplicados, ex: Set-Cookie).
    pub headers: Vec<KeyVal>,
    /// Corpo decodificado como texto (lossy se nao for UTF-8 valido).
    pub body: String,
    /// True se o corpo nao era UTF-8 valido (decodificado de forma lossy).
    pub body_truncated_lossy: bool,
    /// Duracao total em milissegundos.
    pub time_ms: u64,
    /// Tamanho do corpo em bytes.
    pub size_bytes: u64,
}

/// Erro de envio, serializavel pro IPC. Sem panic: rede/timeout/URL invalida
/// viram variantes tipadas. Serializa como objeto {kind, message} pro front
/// poder distinguir tipos de falha (timeout vs DNS vs build).
#[derive(Debug, Error)]
pub enum HttpError {
    #[error("URL invalida: {0}")]
    InvalidUrl(String),

    #[error("metodo HTTP invalido: {0}")]
    InvalidMethod(String),

    #[error("header invalido: {0}")]
    InvalidHeader(String),

    #[error("falha ao montar o cliente HTTP: {0}")]
    Build(String),

    #[error("timeout ao conectar/aguardar resposta")]
    Timeout,

    #[error("falha de conexao: {0}")]
    Connect(String),

    #[error("falha ao ler o corpo da resposta: {0}")]
    Body(String),

    #[error("erro de rede: {0}")]
    Network(String),
}

impl HttpError {
    /// Discriminante estavel (string) pro front decidir UI por tipo de erro.
    pub fn kind(&self) -> &'static str {
        match self {
            HttpError::InvalidUrl(_) => "invalidUrl",
            HttpError::InvalidMethod(_) => "invalidMethod",
            HttpError::InvalidHeader(_) => "invalidHeader",
            HttpError::Build(_) => "build",
            HttpError::Timeout => "timeout",
            HttpError::Connect(_) => "connect",
            HttpError::Body(_) => "body",
            HttpError::Network(_) => "network",
        }
    }
}

/// Converte erro do reqwest em HttpError tipado (classifica timeout/connect/body).
impl From<reqwest::Error> for HttpError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            HttpError::Timeout
        } else if e.is_connect() {
            HttpError::Connect(e.to_string())
        } else if e.is_body() || e.is_decode() {
            HttpError::Body(e.to_string())
        } else if e.is_builder() {
            HttpError::Build(e.to_string())
        } else {
            HttpError::Network(e.to_string())
        }
    }
}

// Serializa como {kind, message} pro front. Usa serialize_map manual pra nao
// depender de struct intermediaria.
impl Serialize for HttpError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("kind", self.kind())?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}
