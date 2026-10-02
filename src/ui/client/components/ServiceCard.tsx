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
  onExport: () => void;
  onImport: () => void;
}

export const ServiceCard: FC<Props> = ({
  name,
  service,
  disabled,
  onAction,
  onExport,
  onImport,
}) => (
  <section class="card">
    <div class="head">
      <span class={service.running ? "dot on" : "dot"} />
      <h2>{name}</h2>
      <span class={service.running ? "badge on" : "badge"}>
        {service.running ? "running" : "stopped"}
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
          Encrypted with the panel password. Import replaces the current config.
        </p>
      </>
    ) : null}
  </section>
);
