import "dotenv/config";
import { createMockEhrApp } from "./app";

const PORT = Number(process.env.MOCK_EHR_PORT ?? process.env.PORT ?? 4100);
const { app } = createMockEhrApp({
  apiKey: process.env.MOCK_EHR_API_KEY,
  seed: true,
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-ehr] listening on port ${PORT}`);
});
