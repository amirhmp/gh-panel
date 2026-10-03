// The few GitHub REST calls the client needs. The token needs
// "Actions: read and write" on the repository (fine-grained token),
// or the `repo` + `workflow` scopes (classic token).
import type { Settings, WorkflowRun } from "./types";

const API = "https://api.github.com";

export const ACTIVE = [
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
];
export const isActive = (r: WorkflowRun | null): boolean =>
  !!r && ACTIVE.includes(r.status);

async function gh(
  s: Settings,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${s.githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {}
    const hint =
      res.status === 401
        ? "token rejected"
        : res.status === 403 || res.status === 404
          ? "check the repository name and that the token has Actions read/write access"
          : "";
    throw new Error(
      [`GitHub ${res.status}`, detail, hint].filter(Boolean).join(": "),
    );
  }
  return res;
}

const repoPath = (s: Settings): string => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo))
    throw new Error('Repository must look like "owner/repo"');
  return `/repos/${s.repo}`;
};
const workflowPath = (s: Settings): string =>
  `${repoPath(s)}/actions/workflows/${encodeURIComponent(s.workflow)}`;

export async function dispatchWorkflow(s: Settings): Promise<void> {
  await gh(s, `${workflowPath(s)}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: s.ref }),
  });
}

/** Newest runs of the workflow, newest first. */
export async function listRuns(s: Settings): Promise<WorkflowRun[]> {
  const res = await gh(
    s,
    `${workflowPath(s)}/runs?event=workflow_dispatch&per_page=5`,
  );
  return ((await res.json()) as { workflow_runs: WorkflowRun[] }).workflow_runs;
}

export async function cancelRun(s: Settings, id: number): Promise<void> {
  await gh(s, `${repoPath(s)}/actions/runs/${id}/cancel`, { method: "POST" });
}
