# GH Panel desktop client

A [Tauri 2](https://tauri.app) app: the window is a web UI (Preact + TypeScript, in `src/`), and a small Rust program (`src-tauri/src/lib.rs`) does what a web page cannot: keep secrets in the OS keychain, call the panel over the tailnet, and run the local `tailscale` command. See the root README for what the app does.

You will almost never need to write Rust: day to day you edit `src/` (TypeScript). Rust only has to be installed so the app can be compiled.

## One-time setup on Windows

Do these in order. Close and reopen your terminal after steps 1 and 3 so the new tools are found.

1. **C++ build tools** (Rust on Windows uses Microsoft's linker).
   Download _Build Tools for Visual Studio 2022_ from https://visualstudio.microsoft.com/visual-cpp-build-tools/, run it, tick **Desktop development with C++**, install (about 6 GB). If you already have Visual Studio with that workload, skip this.
2. **WebView2**: it is built into Windows 11 and up-to-date Windows 10. Nothing to do; if the app window stays blank, install the _Evergreen Runtime_ from Microsoft.
3. **Rust**: download and run `rustup-init.exe` from https://rustup.rs and press Enter to accept the defaults (the `stable-x86_64-pc-windows-msvc` toolchain). Then check in a new terminal:
   ```
   rustc --version
   cargo --version
   ```
4. **Node.js 22.13 or newer** from https://nodejs.org (`node --version` to check).
5. **Tailscale** installed and logged in to your tailnet (the app talks to it).
6. From the repository root:
   ```
   npm install
   npm run client
   ```
   The first run compiles about 400 Rust libraries and takes **5 to 15 minutes**. That is normal; afterwards only your own changes recompile (seconds). A window opens when it is done.

Build an installer (`.msi` and `.exe`) with `npm run client:build`; they appear in `src-tauri/target/release/bundle/`. You can also build installers for all systems on GitHub without installing Rust: _Actions → Build desktop client_.

## macOS / Linux

- macOS: `xcode-select --install`, then Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`) and Node.
- Linux (Debian/Ubuntu): `sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev libxdo-dev`, then Rust and Node. Allow Tailscale control once: `sudo tailscale set --operator=$USER`.

## Rust in five minutes

| Thing                       | What it is                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `rustup`                    | Installs and updates Rust (`rustup update`).                                                       |
| `cargo`                     | Rust's npm: builds the code and downloads libraries ("crates").                                    |
| `src-tauri/Cargo.toml`      | Rust's `package.json` (dependencies, name, version).                                               |
| `src-tauri/Cargo.lock`      | Rust's lockfile. Commit it.                                                                        |
| `src-tauri/target/`         | Build output (like `dist/` plus `node_modules` cache). Several GB, ignored by git, safe to delete. |
| `src-tauri/tauri.conf.json` | Window size, app name, security policy, installer settings.                                        |
| `src-tauri/src/lib.rs`      | The Rust code. Functions marked `#[tauri::command]` are what the UI calls with `invoke(...)`.      |

Useful commands, run inside `src-tauri/`:

- `cargo check` compiles without producing a program. Fastest way to see Rust errors.
- `cargo clean` deletes `target/` (use it if the disk is full or the build acts strangely).

How a call flows: the UI calls `invoke("tailscale_status", {...})` (in `src/backend.ts`), Tauri runs the Rust function of that name, and the returned struct arrives in TypeScript as JSON. To add a feature that needs the OS, write a `#[tauri::command]` function in `lib.rs`, add it to `generate_handler![...]` at the bottom, and wrap it in `src/backend.ts`. Rust's compiler messages are long but usually say exactly what to change.

## Troubleshooting

- `linker 'link.exe' not found` or "Microsoft Visual C++ ... is required": step 1 is missing or the terminal was not reopened.
- `'cargo' is not recognized`: reopen the terminal after installing Rust.
- Build errors about long file names: keep the repository on a short path such as `C:\dev\gh-panel`.
- Port 1420 already in use: another `npm run client` is still running; close it.
- The first compile is very slow with an antivirus scanning `target/`: exclude that folder.
- "Access denied" when switching the exit node: Tailscale is set up for another user. Run the app as administrator once, or see Tailscale's _operator_ setting.
- The installer says "Unknown publisher": it is not code-signed. Choose _More info → Run anyway_.
