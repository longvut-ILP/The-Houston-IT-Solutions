// Vercel serverless entry point.
//
// Exporting the Express app lets Vercel route every request to it. The app is
// built once per warm function instance (module scope), so the pg pool is
// reused across invocations on the same instance.
//
// Pair this with vercel.json, which routes all paths to this function.
import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../src/http/app";

// Build the app once at cold start. If that throws, capture it so we can return
// a readable error instead of an opaque "function crashed" page.
let app: ReturnType<typeof createApp> | undefined;
let initError: unknown;
try {
  app = createApp();
} catch (err) {
  initError = err;
  // eslint-disable-next-line no-console
  console.error("createApp() failed at cold start:", err);
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (!app) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: "InitError",
        message: initError instanceof Error ? initError.message : String(initError),
      })
    );
    return;
  }
  // Hand the request to Express.
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
