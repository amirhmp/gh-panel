import {
  API,
  DEFAULT_PORTS,
  EXIT_NODE_TOGGLE,
  type ServicesResponse,
} from "@gh-panel/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  loadSettings,
  openExternal,
  panel,
  saveSettings,
  setExitNode,
  tailscaleStatus,
  type PanelTarget,
} from "./backend";
import { BottomBar, ServicesList, SettingsDialog } from "./components";
import { cancelRun, dispatchWorkflow, isActive, listRuns } from "./github";
import type { Settings, TailscaleInfo, WorkflowRun } from "./types";
import { errorText, formatDuration, sleep, useInterval, useNow } from "./util";

type Phase = "setup" | "stopped" | "queued" | "starting" | "ready" | "stopping";

const PHASE_LABEL: Record<Phase, string> = {
  setup: "Not configured",
  stopped: "Stopped",
  queued: "Waiting for a runner…",
  starting: "Starting…",
  ready: "Running",
  stopping: "Stopping…",
};

const EXIT_NODE_NOT_APPROVED =
  "The runner advertises itself as an exit node, but your tailnet has not approved it yet. " +
  'Approve it in the Tailscale admin console (Machines, "…", Edit route settings), ' +
  "or add an autoApprovers rule for exitNode to your ACL so it happens automatically.";

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [runError, setRunError] = useState("");
  const [waitingForRun, setWaitingForRun] = useState(false);
  const [ts, setTs] = useState<TailscaleInfo | null>(null);
  const [services, setServices] = useState<ServicesResponse | null>(null);
  const [panelError, setPanelError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const dispatchedAt = useRef(0);
  const toastTimer = useRef<number | undefined>(undefined);

  const say = (text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      error ? 9000 : 3000,
    );
  };

  /* ---- settings ---- */
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      if (!s.repo || !s.githubToken) setShowSettings(true);
    });
  }, []);

  const configured =
    !!settings &&
    /^[\w.-]+\/[\w.-]+$/.test(settings.repo) &&
    !!settings.githubToken;

  /* ---- derived ---- */
  const active = isActive(run);
  const peer = ts?.peer ?? null;
  const host = peer?.dnsName || peer?.ip || "";
  const panelOk = !!services;
  const target: PanelTarget | null =
    settings && host && settings.panelPassword
      ? {
          host,
          port: DEFAULT_PORTS.panel,
          username: settings.panelUsername,
          password: settings.panelPassword,
        }
      : null;
  const tunOn = !!peer?.exitNode;

  let phase: Phase = "stopped";
  if (!configured) phase = "setup";
  else if (busy === "stopping") phase = "stopping";
  else if (waitingForRun || (active && run?.status !== "in_progress"))
    phase = "queued";
  else if (active) phase = panelOk ? "ready" : "starting";

  /* ---- polling ---- */
  const refreshRuns = async () => {
    if (!settings || !configured) return;
    try {
      const runs = await listRuns(settings);
      const since = dispatchedAt.current;
      if (since) {
        // A dispatch returns no run id: find the run created after we asked.
        const fresh = runs.find(
          (r) => Date.parse(r.created_at) >= since - 15_000,
        );
        if (fresh) {
          dispatchedAt.current = 0;
          setWaitingForRun(false);
          setRun(fresh);
        } else if (Date.now() - since > 90_000) {
          dispatchedAt.current = 0;
          setWaitingForRun(false);
          setRunError(
            "The run did not appear. Check the workflow file name and branch in Settings.",
          );
        }
      } else {
        setRun(runs[0] ?? null);
      }
      if (!since || dispatchedAt.current === 0) setRunError("");
    } catch (e) {
      setRunError(errorText(e));
    }
  };
  useInterval(refreshRuns, 5000, configured);

  const refreshTs = async () => {
    if (!settings) return;
    try {
      setTs(await tailscaleStatus(settings.tailscaleHostname));
    } catch (e) {
      setTs({
        available: false,
        backendState: "",
        error: errorText(e),
        peer: null,
      });
    }
  };
  useInterval(refreshTs, 4000, !!settings);

  const refreshServices = async () => {
    if (!target) return;
    try {
      setServices(await panel<ServicesResponse>(target, "GET", API.services));
      setPanelError("");
    } catch (e) {
      setServices(null);
      setPanelError(errorText(e));
    }
  };
  useInterval(
    refreshServices,
    4000,
    !!target && run?.status === "in_progress" && busy !== "stopping",
  );
  useEffect(() => {
    if (!active) {
      setServices(null);
      setPanelError("");
    }
  }, [active]);

  // When the runner is gone, never leave this computer routed through it.
  useEffect(() => {
    if (run && !active && !waitingForRun && tunOn && busy !== "tun") {
      setExitNode(null)
        .then(() => say("Run ended: exit node switched off"))
        .catch((e) => say(errorText(e), true))
        .finally(refreshTs);
    }
  }, [active, run?.id, tunOn]);

  /* ---- actions ---- */
  const start = async () => {
    if (!settings) return;
    setBusy("starting");
    try {
      await dispatchWorkflow(settings);
      dispatchedAt.current = Date.now();
      setWaitingForRun(true);
      setRunError("");
      setTimeout(refreshRuns, 2500);
    } catch (e) {
      say(errorText(e), true);
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!settings || !run) return;
    setBusy("stopping");
    try {
      // 1. Take this computer off the exit node first, or it loses its internet.
      if (peer?.exitNode) await setExitNode(null).catch(() => {});
      // 2. Ask the panel to shut down cleanly; if it is unreachable, cancel the run.
      if (target && panelOk)
        await panel(target, "POST", API.shutdown).catch(() => {});
      else await cancelRun(settings, run.id);
      // 3. Wait for the run to end; cancel it if the clean shutdown did not work.
      for (let i = 0; i < 10; i++) {
        await sleep(2000);
        const latest = (await listRuns(settings)).find((r) => r.id === run.id);
        if (latest && !isActive(latest)) {
          setRun(latest);
          return;
        }
      }
      await cancelRun(settings, run.id).catch(() => {});
    } catch (e) {
      say(errorText(e), true);
    } finally {
      setBusy(null);
      refreshRuns();
      refreshTs();
    }
  };

  const toggleTun = async (on: boolean) => {
    if (!settings) return;
    setBusy("tun");
    try {
      if (on) {
        if (!target) throw new Error("The runner panel is not reachable yet");
        // Runner side: advertise as an exit node.
        await panel(target, "PUT", API.toggle("tailscale", EXIT_NODE_TOGGLE), {
          enabled: true,
        });
        // Wait until the tailnet accepts it.
        let ip = "";
        for (let i = 0; i < 15 && !ip; i++) {
          const t = await tailscaleStatus(settings.tailscaleHostname);
          setTs(t);
          if (t.peer?.exitNodeOption) ip = t.peer.ip;
          else await sleep(2000);
        }
        if (!ip) throw new Error(EXIT_NODE_NOT_APPROVED);
        // Client side: use it.
        await setExitNode(ip);
        say("Exit node on: your traffic now leaves from the runner");
      } else {
        await setExitNode(null);
        if (target) {
          await panel(
            target,
            "PUT",
            API.toggle("tailscale", EXIT_NODE_TOGGLE),
            {
              enabled: false,
            },
          ).catch(() => {});
        }
        say("Exit node off");
      }
    } catch (e) {
      say(errorText(e), true);
    } finally {
      setBusy(null);
      refreshTs();
      refreshServices();
    }
  };

  const serviceAction = async (
    name: string,
    action: "start" | "stop" | "restart" | "install",
  ) => {
    if (!target) return;
    setBusy(`svc:${name}`);
    try {
      await panel(
        target,
        "POST",
        action === "install" ? API.install(name) : API.action(name, action),
      );
    } catch (e) {
      say(errorText(e), true);
    } finally {
      setBusy(null);
      refreshServices();
    }
  };

  const copy = (v: string) =>
    navigator.clipboard.writeText(v).then(
      () => say(`Copied ${v}`),
      () => say("Could not copy to the clipboard", true),
    );

  const onSaveSettings = async (s: Settings) => {
    await saveSettings(s);
    setSettings(s);
    setShowSettings(false);
    setRun(null);
    setServices(null);
  };

  /* ---- render ---- */
  const now = useNow(run?.status === "in_progress");
  const runningFor = run?.run_started_at
    ? formatDuration(now - Date.parse(run.run_started_at))
    : "";

  let hint = "";
  if (phase === "starting") {
    if (!settings?.panelPassword) hint = "Set the panel password in Settings.";
    else if (ts && !ts.available) hint = ts.error;
    else if (ts && ts.backendState && ts.backendState !== "Running")
      hint =
        "Tailscale is not connected on this computer. Connect it to reach the runner.";
    else if (!peer)
      hint = `Waiting for "${settings?.tailscaleHostname}" to join your tailnet…`;
    else hint = panelError || "Waiting for the panel to come up…";
  }

  const tunDisabled = !panelOk
    ? "needs a running runner"
    : ts && !ts.available
      ? "tailscale unavailable"
      : "";

  if (!settings) return <div class="boot">Loading…</div>;

  const canStop =
    (active || phase === "queued") && !!run && busy !== "stopping";

  return (
    <div class="app">
      <header class="top">
        <h1>GH Panel</h1>
        <span class={`pill pill--${phase}`}>{PHASE_LABEL[phase]}</span>
        <button class="ghost" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>

      <main class="main">
        <section class="card hero">
          <div class="hero__text">
            <h2>{settings.repo || "No repository yet"}</h2>
            <p class="muted">
              {phase === "ready" && `Runner ${host} · up ${runningFor}`}
              {phase === "starting" && `Job running for ${runningFor}`}
              {phase === "queued" && "Waiting for GitHub to assign a runner."}
              {phase === "stopped" &&
                (run
                  ? `Last run: ${run.conclusion ?? run.status}`
                  : configured
                    ? "Press Run to start the workflow."
                    : "Open Settings to add your repository and token.")}
              {phase === "stopping" && "Shutting the runner down…"}
              {phase === "setup" &&
                "Open Settings to add your repository and token."}
            </p>
            {hint && <p class="hint">{hint}</p>}
            {runError && <p class="error">{runError}</p>}
          </div>
          <div class="hero__actions">
            {run && (
              <button class="ghost" onClick={() => openExternal(run.html_url)}>
                View run on GitHub
              </button>
            )}
            {panelOk && target && (
              <button
                class="ghost"
                onClick={() =>
                  openExternal(`http://${target.host}:${DEFAULT_PORTS.panel}`)
                }
              >
                Open panel
              </button>
            )}
            {canStop ? (
              <button class="danger" onClick={stop}>
                Stop
              </button>
            ) : (
              <button
                class="primary"
                onClick={start}
                disabled={
                  !configured ||
                  busy !== null ||
                  phase === "queued" ||
                  phase === "stopping"
                }
              >
                {busy === "starting" ? "Starting…" : "Run workflow"}
              </button>
            )}
          </div>
        </section>

        {services && (
          <section class="card">
            <h3>Services</h3>
            <ServicesList
              services={services}
              busy={busy}
              onAction={serviceAction}
            />
          </section>
        )}
      </main>

      <BottomBar
        host={host || settings.tailscaleHostname}
        services={services}
        tunOn={tunOn}
        tunBusy={busy === "tun"}
        tunDisabled={tunDisabled}
        onTun={toggleTun}
        onCopy={copy}
      />

      {toast && (
        <div class={`toast${toast.error ? " toast--error" : ""}`}>
          {toast.text}
        </div>
      )}

      {showSettings && (
        <SettingsDialog
          initial={settings}
          firstRun={!configured}
          onSave={onSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
