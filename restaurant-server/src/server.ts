import "dotenv/config";
import { createApp } from "./http/app";

const port = Number(process.env.PORT ?? 4100);

createApp().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Restaurant POS API listening on http://localhost:${port}`);
});
