import { useCallback, useRef, useState, type FC } from "hono/jsx/dom";
import type { ServiceAction, ServicesResponse } from "../../../shared/types";
import {
  controlService,
  exportServiceConfig,
  getServices,
  importServiceConfig,
  installService,
  setServiceToggle,
} from "../api";
import { downloadBlob } from "../download";
import { usePoll } from "../hooks";
import { toast, toastError } from "../toast";
import { ServiceCard } from "./ServiceCard";

const POLL_MS = 5000;
/** Busy key that disables every card (used while a config import runs). */
const ALL = "*";

interface Props {
  /** false once a shutdown has been requested: stop polling. */
  active: boolean;
}

/** The "Services" header and one card per service, refreshed every 5 s. */
export const ServicesSection: FC<Props> = ({ active }) => {
  const [services, setServices] = useState<ServicesResponse | null>(null);
  const [updated, setUpdated] = useState("");
  const [busy, setBusy] = useState<readonly string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const importTarget = useRef("");

  const load = useCallback(async () => {
    try {
      setServices(await getServices());
      setUpdated(`Updated ${new Date().toLocaleTimeString()}`);
    } catch {
      setUpdated("Connection lost");
    }
  }, []);
  usePoll(load, POLL_MS, active);

  // Marks `key` busy while `fn` runs, then refreshes the list.
  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy((b) => [...b, key]);
    try {
      await fn();
      await load();
    } finally {
      setBusy((b) => b.filter((k) => k !== key));
    }
  };

  const onAction = (name: string, action: ServiceAction) =>
    withBusy(name, async () => {
      try {
        await controlService(name, action);
      } catch (e) {
        toastError(e);
      }
    });

  const onInstall = (name: string) =>
    withBusy(name, async () => {
      try {
        await installService(name);
        toast(`${name} installed`, "info");
      } catch (e) {
        toastError(e);
      }
    });

  const onToggle = (name: string, key: string, enabled: boolean) =>
    withBusy(name, async () => {
      try {
        await setServiceToggle(name, key, enabled);
      } catch (e) {
        toastError(e);
      }
    });

  const onExport = (name: string) =>
    withBusy(name, async () => {
      try {
        const { blob, filename } = await exportServiceConfig(name);
        downloadBlob(blob, filename);
        toast("Config exported", "info");
      } catch (e) {
        toastError(e);
      }
    });

  const onImportClick = (name: string) => {
    importTarget.current = name;
    const input = fileInput.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const onFileChosen = async () => {
    const file = fileInput.current?.files?.[0];
    const name = importTarget.current;
    if (!file) return;
    if (
      !confirm(
        `Import ${file.name} into ${name}? This replaces its current config and restarts it if it is running.`,
      )
    )
      return;
    await withBusy(ALL, async () => {
      try {
        await importServiceConfig(name, file);
        toast("Config imported", "info");
      } catch (e) {
        toastError(e);
      }
    });
  };

  const entries = services ? Object.entries(services) : null;

  return (
    <>
      <header>
        <h1>Services</h1>
        <span class="sub">{updated}</span>
      </header>

      <div>
        {entries?.length === 0 ? <div class="empty">No services</div> : null}
        {entries?.map(([name, service]) => (
          <ServiceCard
            key={name}
            name={name}
            service={service}
            disabled={busy.includes(ALL) || busy.includes(name)}
            onAction={(action) => void onAction(name, action)}
            onInstall={() => void onInstall(name)}
            onToggle={(key, enabled) => void onToggle(name, key, enabled)}
            onExport={() => void onExport(name)}
            onImport={() => onImportClick(name)}
          />
        ))}
      </div>

      <input
        type="file"
        hidden
        ref={fileInput}
        onChange={() => void onFileChosen()}
      />
    </>
  );
};
