import { Hono } from "hono";
import { Layout } from "../ui/Layout";

/** The panel page: a server-rendered shell that loads the browser app. */
export function pageRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.html(<Layout />));
  return app;
}
