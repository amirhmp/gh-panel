import { useState } from "preact/hooks";
import { DEFAULT_PORTS, type ServicesResponse } from "@gh-panel/shared";
import type { Settings } from "./types";

/* ------------------------------------------------------------ bottom bar */

function Address(props: {
  label: string;
  value: string;
  live: boolean;
  onCopy: (v: string) => void;
}) {
  return (
    <button
      class={`addr${props.live ? "" : " addr--idle"}`}
      title={`Copy ${props.value}`}
      onClick={() => props.onCopy(props.value)}
    >
      <span class="addr__label">{props.label}</span>
      <span class="addr__value">{props.value}</span>
    </button>
  );
}

/** Splits "host:port" (the panel reports proxies like that). */
const withPort = (info: string | undefined, host: string, port: number) =>
  info && /:\d+$/.test(info) ? info : `${host}:${port}`;

export function BottomBar(props: {
  host: string;
  services: ServicesResponse | null;
  tunOn: boolean;
  tunBusy: boolean;
  tunDisabled: string;
  onTun: (on: boolean) => void;
  onCopy: (v: string) => void;
}) {
  const { host, services } = props;
  const proxy = services?.proxy;
  const socks = services?.socks;
  return (
    <footer class="bar">
      <div class="bar__addrs">
        <Address
          label="Panel"
          value={`${host}:${DEFAULT_PORTS.panel}`}
          live={!!services}
          onCopy={props.onCopy}
        />
        <Address
          label="HTTP proxy"
          value={withPort(
            proxy?.running ? proxy.info : "",
            host,
            DEFAULT_PORTS.proxy,
          )}
          live={!!proxy?.running}
          onCopy={props.onCopy}
        />
        <Address
          label="SOCKS5"
          value={withPort(
            socks?.running ? socks.info : "",
            host,
            DEFAULT_PORTS.socks,
          )}
          live={!!socks?.running}
          onCopy={props.onCopy}
        />
      </div>
      <label
        class={`tun${props.tunDisabled && !props.tunOn ? " tun--disabled" : ""}`}
        title={
          props.tunDisabled ||
          "Route this computer's traffic through the runner"
        }
      >
        <span class="tun__text">
          <strong>TUN</strong>
          <small>
            {props.tunBusy
              ? "working…"
              : props.tunOn
                ? "exit node on"
                : props.tunDisabled || "exit node off"}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={props.tunOn}
          disabled={props.tunBusy || (!!props.tunDisabled && !props.tunOn)}
          onChange={(e) =>
            props.onTun((e.currentTarget as HTMLInputElement).checked)
          }
        />
        <span class="switch" aria-hidden="true" />
      </label>
    </footer>
  );
}

/* -------------------------------------------------------------- services */

export function ServicesList(props: {
  services: ServicesResponse;
  busy: string | null;
  onAction: (
    name: string,
    action: "start" | "stop" | "restart" | "install",
  ) => void;
}) {
  const entries = Object.entries(props.services);
  return (
    <ul class="services">
      {entries.map(([name, s]) => {
        const working = props.busy === `svc:${name}` || s.installing;
        const off = !!props.busy;
        return (
          <li key={name} class="service">
            <span class={`dot${s.running ? " dot--on" : ""}`} />
            <div class="service__main">
              <strong>{name}</strong>
              <span class="service__info">
                {s.installable && !s.installed
                  ? "not installed"
                  : s.info || (s.running ? "running" : "stopped")}
              </span>
              {s.details?.[0] && (
                <span class="service__info">
                  {s.details[0].label}: {s.details[0].value}
                </span>
              )}
            </div>
            <div class="service__actions">
              {s.installable && !s.installed ? (
                <button
                  disabled={off || working}
                  onClick={() => props.onAction(name, "install")}
                >
                  {working ? "installing…" : "install"}
                </button>
              ) : (
                s.controllable && (
                  <>
                    <button
                      disabled={off || working}
                      onClick={() =>
                        props.onAction(name, s.running ? "stop" : "start")
                      }
                    >
                      {s.running ? "stop" : "start"}
                    </button>
                    <button
                      disabled={off || working || !s.running}
                      onClick={() => props.onAction(name, "restart")}
                    >
                      restart
                    </button>
                  </>
                )
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------- settings */

export function SettingsDialog(props: {
  initial: Settings;
  firstRun: boolean;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
}) {
  const [s, setS] = useState<Settings>(props.initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Settings) => (e: Event) =>
    setS({ ...s, [k]: (e.currentTarget as HTMLInputElement).value.trim() });

  const submit = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await props.onSave(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div class="overlay">
      <form class="dialog" onSubmit={submit}>
        <h2>Settings</h2>
        <p class="muted">
          The token and the panel password are kept in your operating system's
          keychain.
        </p>

        <h3>GitHub</h3>
        <label>
          Repository
          <input
            value={s.repo}
            onInput={set("repo")}
            placeholder="owner/repo"
            required
          />
        </label>
        <div class="row">
          <label>
            Workflow file
            <input value={s.workflow} onInput={set("workflow")} required />
          </label>
          <label>
            Branch
            <input value={s.ref} onInput={set("ref")} required />
          </label>
        </div>
        <label>
          Access token
          <input
            type="password"
            value={s.githubToken}
            onInput={set("githubToken")}
            placeholder="github_pat_…"
            autocomplete="off"
            required
          />
          <small>
            Fine-grained token with <em>Actions: read and write</em> on that
            repository (or a classic token with <em>repo</em> +{" "}
            <em>workflow</em>).
          </small>
        </label>

        <h3>Runner</h3>
        <label>
          Tailscale machine name
          <input
            value={s.tailscaleHostname}
            onInput={set("tailscaleHostname")}
            placeholder="github-ubuntu"
            required
          />
          <small>The TAILSCALE_HOSTNAME variable of the repository.</small>
        </label>
        <div class="row">
          <label>
            Panel username
            <input
              value={s.panelUsername}
              onInput={set("panelUsername")}
              required
            />
          </label>
          <label>
            Panel password
            <input
              type="password"
              value={s.panelPassword}
              onInput={set("panelPassword")}
              autocomplete="off"
              required
            />
          </label>
        </div>

        {error && <p class="error">{error}</p>}
        <div class="dialog__buttons">
          {!props.firstRun && (
            <button type="button" onClick={props.onClose} disabled={saving}>
              Cancel
            </button>
          )}
          <button class="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
