import {
  useCallback,
  useEffect,
  useState,
  type FC,
  type PropsWithChildren,
} from "hono/jsx/dom";
import type { RunnerInfo, SystemInfo } from "../../../shared/types";
import { errorText, getRunner, getSystem } from "../api";
import { flag, fmtDuration, fmtTime, mapUrl } from "../format";
import { useClock, usePoll } from "../hooks";
import { ShutdownZone } from "./ShutdownZone";
import { TrafficTable } from "./TrafficTable";

const SYSTEM_POLL_MS = 5000;

const Row: FC<PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div class="row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

interface Props {
  /** false once a shutdown has been requested: stop polling. */
  active: boolean;
  onShutdown: () => void;
}

/** Everything about the VM: public IP, location, clock, uptime, traffic, shutdown. */
export const ServerCard: FC<Props> = ({ active, onShutdown }) => {
  // Public IP and location: looked up once (the server caches it), plus a refresh button.
  const [runner, setRunner] = useState<RunnerInfo | null>(null);
  const [runnerError, setRunnerError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadRunner = useCallback(async (refresh = false) => {
    setRefreshing(true);
    try {
      setRunner(await getRunner(refresh));
      setRunnerError("");
    } catch (e) {
      setRunnerError(errorText(e));
    }
    setRefreshing(false);
  }, []);
  useEffect(() => void loadRunner(), []);

  // Live VM facts are polled; between polls uptime and the clock tick locally.
  const [system, setSystem] = useState<{
    data: SystemInfo;
    receivedAt: number;
  } | null>(null);
  usePoll(
    async () => {
      try {
        setSystem({ data: await getSystem(), receivedAt: Date.now() });
      } catch {}
    },
    SYSTEM_POLL_MS,
    active,
  );
  const now = useClock();

  const elapsed = system ? Math.max(0, now - system.receivedAt) : 0;
  const place = runner
    ? [runner.city, runner.region, runner.country].filter(Boolean).join(", ")
    : "";

  return (
    <section class="card server-card">
      <div class="head">
        <h2>Server</h2>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadRunner(true)}
        >
          refresh
        </button>
      </div>

      <dl class="kv">
        <Row label="Public IP">
          <code>
            {runnerError
              ? `Unavailable: ${runnerError}`
              : (runner?.ip ?? "Loading…")}
          </code>
        </Row>
        {runner && place ? (
          <Row label="Location">
            {[flag(runner.countryCode), place].filter(Boolean).join(" ")}
            {runner.loc ? (
              <>
                {" · "}
                <a
                  href={mapUrl(runner.loc)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  map
                </a>
              </>
            ) : null}
          </Row>
        ) : null}
        {runner?.org ? <Row label="Provider">{runner.org}</Row> : null}
        <Row label="Server time">
          {system
            ? fmtTime(system.data.serverTime + elapsed, system.data.timezone)
            : "…"}
        </Row>
        <Row label="Uptime">
          {system
            ? fmtDuration(system.data.uptimeSeconds + elapsed / 1000)
            : "…"}
        </Row>
        <Row label="Booted">
          {system
            ? fmtTime(
                system.data.serverTime - system.data.uptimeSeconds * 1000,
                system.data.timezone,
              )
            : "…"}
        </Row>
      </dl>

      {system?.data.traffic ? (
        <TrafficTable traffic={system.data.traffic} />
      ) : null}

      <p class="note">
        Location is approximate (IP geolocation of the data center). Traffic
        counts since the VM booted and includes setup downloads. The highlighted
        interface is the real internet traffic; virtual interfaces (tailscale0,
        docker0…) also cross it, so the total can count the same bytes twice.
      </p>

      <ShutdownZone disabled={!active} onShutdown={onShutdown} />
    </section>
  );
};
