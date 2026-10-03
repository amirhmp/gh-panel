//! Backend of the GH Panel desktop client.
//!
//! The web UI does the GitHub calls itself (HTTPS, CORS allowed). Everything the
//! webview cannot or should not do lives here:
//!   * secrets (GitHub token, panel password) in the OS keychain,
//!   * calls to the panel on the runner (plain HTTP over the tailnet: blocked in
//!     a webview by CORS / mixed content),
//!   * the local `tailscale` CLI (find the runner, set / clear the exit node).

use std::{
    net::IpAddr,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const KEYRING_SERVICE: &str = "gh-panel-client";
const SECRET_TOKEN: &str = "github-token";
const SECRET_PANEL_PASSWORD: &str = "panel-password";

#[derive(Default)]
struct AppState {
    /// We set the exit node and have not cleared it yet.
    exit_node_set: AtomicBool,
}

// ---------------------------------------------------------------- settings

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    /// "owner/repo" that holds the workflow.
    repo: String,
    /// Workflow file name, e.g. "panel.yml".
    workflow: String,
    #[serde(rename = "ref")]
    git_ref: String,
    /// TAILSCALE_HOSTNAME of the runner.
    tailscale_hostname: String,
    /// PANEL_USERNAME
    panel_username: String,
    /// Kept in the OS keychain, never written to the settings file.
    github_token: String,
    /// PANEL_PASSWORD, kept in the OS keychain.
    panel_password: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            repo: String::new(),
            workflow: "panel.yml".into(),
            git_ref: "main".into(),
            tailscale_hostname: "github-ubuntu".into(),
            panel_username: "admin".into(),
            github_token: String::new(),
            panel_password: String::new(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn secret_entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| format!("keychain: {e}"))
}

fn get_secret(name: &str) -> Result<String, String> {
    match secret_entry(name)?.get_password() {
        Ok(v) => Ok(v),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(format!("keychain: {e}")),
    }
}

fn set_secret(name: &str, value: &str) -> Result<(), String> {
    let entry = secret_entry(name)?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keychain: {e}")),
        };
    }
    entry
        .set_password(value)
        .map_err(|e| format!("keychain: {e} (is a keychain / secret service available?)"))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    let mut s: Settings = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    };
    // A keychain problem must not lock the user out of the app: report it in the UI
    // only when saving, and start with empty secrets here.
    s.github_token = get_secret(SECRET_TOKEN).unwrap_or_default();
    s.panel_password = get_secret(SECRET_PANEL_PASSWORD).unwrap_or_default();
    Ok(s)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    set_secret(SECRET_TOKEN, &settings.github_token)?;
    set_secret(SECRET_PANEL_PASSWORD, &settings.panel_password)?;
    let mut plain = settings;
    plain.github_token.clear();
    plain.panel_password.clear();
    let text = serde_json::to_string_pretty(&plain).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(&app)?, text).map_err(|e| e.to_string())
}

// ------------------------------------------------------------- panel proxy

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PanelRequest {
    host: String,
    port: u16,
    username: String,
    password: String,
    method: String,
    path: String,
    body: Option<Value>,
}

#[derive(Serialize)]
struct PanelResponse {
    status: u16,
    body: Value,
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// Calls the panel API on the runner (`/api/...` only) with basic auth.
#[tauri::command]
async fn panel_request(req: PanelRequest) -> Result<PanelResponse, String> {
    if !valid_host(&req.host) {
        return Err("invalid panel host".into());
    }
    if !req.path.starts_with("/api/") || req.path.contains("..") {
        return Err("invalid panel path".into());
    }
    let method = match req.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        _ => return Err("unsupported method".into()),
    };
    let client = reqwest::Client::builder()
        .no_proxy() // never send tailnet traffic through a system proxy
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(120)) // installs keep the request open
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://{}:{}{}", req.host, req.port, req.path);
    let mut builder = client
        .request(method, url)
        .basic_auth(&req.username, Some(&req.password));
    if let Some(body) = &req.body {
        builder = builder.json(body);
    }
    let resp = builder.send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "runner not reachable over the tailnet".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let body = serde_json::from_str(&text).unwrap_or(Value::String(text));
    Ok(PanelResponse { status, body })
}

// --------------------------------------------------------------- tailscale

fn tailscale_command() -> Command {
    let candidates: &[&str] = if cfg!(target_os = "macos") {
        &[
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
        ]
    } else if cfg!(target_os = "windows") {
        &[
            "C:\\Program Files\\Tailscale\\tailscale.exe",
            "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
        ]
    } else {
        &["/usr/bin/tailscale", "/usr/sbin/tailscale", "/usr/local/bin/tailscale"]
    };
    let program = candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .copied()
        .unwrap_or("tailscale");
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Runs `tailscale <args>`. Err: not installed, or the CLI's own error message.
fn tailscale(args: &[&str]) -> Result<String, String> {
    let out = tailscale_command().args(args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "the tailscale CLI was not found: is Tailscale installed?".to_string()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        })
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Peer {
    host_name: String,
    dns_name: String,
    ip: String,
    online: bool,
    /// Approved as an exit node (advertised and accepted by the tailnet).
    exit_node_option: bool,
    /// This computer currently sends its traffic through it.
    exit_node: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct TailscaleInfo {
    /// The CLI ran and answered.
    available: bool,
    backend_state: String,
    error: String,
    /// The runner, if it is in the tailnet.
    peer: Option<Peer>,
}

fn peer_from(v: &Value) -> Peer {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let b = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    let ip = v
        .get("TailscaleIPs")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().filter_map(Value::as_str).find(|ip| !ip.contains(':')))
        .unwrap_or("")
        .to_string();
    Peer {
        host_name: s("HostName"),
        dns_name: s("DNSName").trim_end_matches('.').to_string(),
        ip,
        online: b("Online"),
        exit_node_option: b("ExitNodeOption"),
        exit_node: b("ExitNode"),
    }
}

/// `github-ubuntu`, or `github-ubuntu-1` (Tailscale's suffix for a repeated name).
fn is_runner_name(host_name: &str, wanted: &str) -> bool {
    let h = host_name.to_ascii_lowercase();
    let w = wanted.to_ascii_lowercase();
    h == w
        || h.strip_prefix(&format!("{w}-"))
            .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
}

/// Finds the runner among the peers of this computer's Tailscale.
#[tauri::command]
async fn tailscale_status(hostname: String) -> TailscaleInfo {
    tauri::async_runtime::spawn_blocking(move || {
        let text = match tailscale(&["status", "--json"]) {
            Ok(t) => t,
            Err(error) => return TailscaleInfo { error, ..Default::default() },
        };
        let v: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                return TailscaleInfo { error: format!("unreadable tailscale status: {e}"), ..Default::default() }
            }
        };
        let backend_state = v.get("BackendState").and_then(Value::as_str).unwrap_or("").to_string();
        let mut peers: Vec<Peer> = v
            .get("Peer")
            .and_then(Value::as_object)
            .map(|m| m.values().map(peer_from).collect())
            .unwrap_or_default();
        peers.retain(|p| is_runner_name(&p.host_name, &hostname));
        // Prefer a live runner over a stale (offline) leftover with the same name.
        peers.sort_by_key(|p| (!p.online, !p.exit_node_option));
        TailscaleInfo {
            available: true,
            backend_state,
            error: String::new(),
            peer: peers.into_iter().next(),
        }
    })
    .await
    .unwrap_or_else(|e| TailscaleInfo { error: e.to_string(), ..Default::default() })
}

fn clear_exit_node() -> Result<(), String> {
    tailscale(&["set", "--exit-node="]).map(|_| ())
}

/// Sends this computer's traffic through the runner (`Some(ip)`), or stops (`None`).
#[tauri::command]
async fn set_exit_node(state: State<'_, AppState>, ip: Option<String>) -> Result<(), String> {
    let enable = ip.is_some();
    tauri::async_runtime::spawn_blocking(move || match ip {
        Some(ip) => {
            ip.parse::<IpAddr>().map_err(|_| "invalid exit node address".to_string())?;
            tailscale(&["set", &format!("--exit-node={ip}"), "--exit-node-allow-lan-access=true"])
                .map(|_| ())
        }
        None => clear_exit_node(),
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| {
        if e.to_ascii_lowercase().contains("access denied") || e.contains("operator") {
            format!("{e}\nOn Linux run once: sudo tailscale set --operator=$USER")
        } else {
            e
        }
    })?;
    state.exit_node_set.store(enable, Ordering::SeqCst);
    Ok(())
}

// ------------------------------------------------------------------- misc

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            panel_request,
            tailscale_status,
            set_exit_node,
            open_external,
        ])
        .on_window_event(|window, event| {
            // Never leave the computer routed through a runner that is about to vanish.
            if let WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<AppState>();
                if state.exit_node_set.swap(false, Ordering::SeqCst) {
                    let _ = clear_exit_node();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the GH Panel client");
}
