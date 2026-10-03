import { useSyncExternalStore, type FC } from "hono/jsx/dom";
import { getToast, subscribeToast } from "../toast";

export const Toast: FC = () => {
  const t = useSyncExternalStore(subscribeToast, getToast);
  const cls = [
    "toast",
    t.kind === "info" ? "toast--info" : "",
    t.visible ? "toast--show" : "",
  ];
  return (
    <div class={cls.filter(Boolean).join(" ")} role="alert">
      {t.text}
    </div>
  );
};
