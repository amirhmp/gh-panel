import type { FC } from "hono/jsx/dom";
import {
  SERVICE_ACTIONS,
  type ServiceAction,
  type ServiceView,
} from "../../../shared/types";
import { isHttpUrl } from "../format";

interface Props {
  name: string;
  service: ServiceView;
  /** A request for this card is in flight. */
  disabled: boolean;
  onAction: (action: ServiceAction) => void;
  onInstall: () => void;
  onToggle: (key: string, enabled: boolean) => void;
  onExport: () => void;
  onImport: () => void;
}

const statusText = (s: ServiceView): string =>
  s.installing
    ? "installing..."
    : !s.installed
      ? "not installed"
      : s.running
        ? "running"
        : "stopped";

export const ServiceCard: FC<Props> = ({
  name,
  service,
  disabled,
  onAction,
  onInstall,
  onToggle,
  onExport,
  onImport,
}) => (
  <section class="card">
    <div class="head">
      <span class={service.running ? "dot on" : "dot"} />
      <h2>{name}</h2>
      <span class={service.running ? "badge on" : "badge"}>
        {statusText(service)}
      </span>
    </div>

    {service.info ? (
      <code>
        {isHttpUrl(service.info) ? (
          <a href={service.info} target="_blank" rel="noopener">
            {service.info}
          </a>
        ) : (
          service.info
        )}
      </code>
    ) : null}

    {service.details?.length ? (
      <dl class="details">
        {service.details.map((d, i) => (
          <div key={`${i}-${d.label}`}>
            <dt>{d.label}</dt>
            <dd>{d.value}</dd>
          </div>
        ))}
      </dl>
    ) : null}

    {service.toggles?.map((t) => (
      <div key={t.key}>
        <div class="toggle">
          <span class="label">{t.label}</span>
          <span class={t.enabled ? "badge on" : "badge"}>
            {t.enabled ? "on" : "off"}
          </span>
          <button
            disabled={disabled}
            onClick={() => onToggle(t.key, !t.enabled)}
          >
            {t.enabled ? "disable" : "enable"}
          </button>
        </div>
        {t.hint ? <p class="note">{t.hint}</p> : null}
      </div>
    ))}

    {!service.installed ? (
      <>
        <div class="actions">
          <button disabled={disabled || service.installing} onClick={onInstall}>
            {service.installing ? "installing..." : "install"}
          </button>
        </div>
        <p class="note">
          Not installed yet. Installing can take a minute; start, stop and the
          other options appear afterwards.
        </p>
      </>
    ) : (
      <>
        {service.controllable ? (
          <div class="actions">
            {SERVICE_ACTIONS.map((action) => (
              <button
                key={action}
                disabled={disabled}
                onClick={() => onAction(action)}
              >
                {action}
              </button>
            ))}
          </div>
        ) : (
          <p class="note">Managed automatically</p>
        )}

        {service.configurable ? (
          <>
            <div class="actions">
              <button disabled={disabled} onClick={onExport}>
                export config
              </button>
              <button disabled={disabled} onClick={onImport}>
                import config
              </button>
            </div>
            <p class="note">
              Encrypted with the panel password. Import replaces the current
              config.
            </p>
          </>
        ) : null}
      </>
    )}
  </section>
);
