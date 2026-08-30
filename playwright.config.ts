import { defineConfig } from "@playwright/test";

const runtimeProcess = Reflect.get(globalThis, "process") as {
  env?: Record<string, string | undefined>;
} | undefined;

const INVALID_E2E_PORT_MESSAGE =
  "WIMY_E2E_PORT must be an integer from 1024 to 65535";

export const parseE2ePort = (value: string | undefined) => {
  if (value === undefined) return 4_173;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new TypeError(INVALID_E2E_PORT_MESSAGE);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new RangeError(INVALID_E2E_PORT_MESSAGE);
  }

  return port;
};

const port = parseE2ePort(runtimeProcess?.env?.WIMY_E2E_PORT);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL,
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
