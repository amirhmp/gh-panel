import type { FC } from "hono/jsx/dom";

interface Props {
  disabled: boolean;
  onShutdown: () => void;
}

export const ShutdownZone: FC<Props> = ({ disabled, onShutdown }) => (
  <div class="danger-zone">
    <p>Stops the services and ends the GitHub Actions workflow run.</p>
    <button class="danger" disabled={disabled} onClick={onShutdown}>
      Shut down & end workflow
    </button>
  </div>
);
