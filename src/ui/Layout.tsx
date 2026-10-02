import { raw } from "hono/html";
import type { FC } from "hono/jsx";

/**
 * Server-rendered HTML shell. The panel itself is the browser app in
 * src/ui/client (built to /assets/app.js) and styled by src/ui/styles
 * (built to /assets/styles.css); both are served by app.ts.
 */
export const Layout: FC = () => (
  <>
    {/* c.html() does not add a doctype for JSX; without it browsers use quirks mode. */}
    {raw("<!DOCTYPE html>")}
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GH Panel</title>
        <link rel="icon" type="image/svg+xml" href="/assets/icon.svg" />
        <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body>
        <div id="root">
          <noscript>The panel needs JavaScript.</noscript>
        </div>
        <script type="module" src="/assets/app.js"></script>
      </body>
    </html>
  </>
);
