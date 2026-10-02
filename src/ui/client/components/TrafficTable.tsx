import type { FC } from "hono/jsx/dom";
import type { Traffic } from "../../../shared/types";
import { fmtBytes } from "../format";

/** Traffic since boot per network interface; the internet-facing one is highlighted. */
export const TrafficTable: FC<{ traffic: Traffic }> = ({ traffic }) => (
  <div class="traffic-wrap">
    <table class="traffic">
      <caption>Network traffic since boot, by interface</caption>
      <thead>
        <tr>
          <th>Interface</th>
          <th>↓ Received</th>
          <th>↑ Sent</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {traffic.interfaces.map((i) => (
          <tr key={i.name} class={i.main ? "main" : undefined}>
            <td>
              {i.name}
              {i.main ? <span class="badge-inet">internet</span> : null}
            </td>
            <td>{fmtBytes(i.rx)}</td>
            <td>{fmtBytes(i.tx)}</td>
            <td>{fmtBytes(i.rx + i.tx)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td>{fmtBytes(traffic.total.rx)}</td>
          <td>{fmtBytes(traffic.total.tx)}</td>
          <td>{fmtBytes(traffic.total.rx + traffic.total.tx)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
);
