import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error that knows which HTTP status the API should answer with. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;

  constructor(message: string, status: ContentfulStatusCode = 500) {
    super(message);
    this.status = status;
  }
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
