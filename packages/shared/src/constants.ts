// Values that more than one app must agree on.

/** Default ports of the services the panel runs on the runner. */
export const DEFAULT_PORTS = {
  panel: 3000,
  proxy: 3128,
  socks: 1080,
  ssh: 22,
  router9: 20128,
} as const;

/** Key of the Tailscale card's exit-node toggle (see PUT .../toggles/:key). */
export const EXIT_NODE_TOGGLE = "exit-node";
