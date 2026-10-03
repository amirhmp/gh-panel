// Shapes shared between the Rust commands and the UI.

export interface Settings {
  /** "owner/repo" that holds the workflow */
  repo: string;
  workflow: string;
  ref: string;
  tailscaleHostname: string;
  panelUsername: string;
  githubToken: string;
  panelPassword: string;
}

export interface Peer {
  hostName: string;
  dnsName: string;
  ip: string;
  online: boolean;
  exitNodeOption: boolean;
  exitNode: boolean;
}

export interface TailscaleInfo {
  available: boolean;
  backendState: string;
  error: string;
  peer: Peer | null;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  run_started_at?: string;
}
