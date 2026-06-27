// Vercel serverless entry point.
//
// Exporting the Express app lets Vercel route every request to it. The app is
// built once per warm function instance (module scope), so the pg pool is
// reused across invocations on the same instance.
//
// Pair this with vercel.json, which routes all paths to this function.
import { createApp } from "../src/http/app";

const app = createApp();

export default app;
