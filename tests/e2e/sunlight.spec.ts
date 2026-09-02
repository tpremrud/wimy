import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const measureTwoAnimationFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame((start) => {
          requestAnimationFrame((end) => resolve(end - start));
        });
      }),
  );

test("keeps the directional sun study local and deterministic", async ({
  page,
}, testInfo) => {
  const externalRequests: string[] = [];
  const localOrigin = new URL(testInfo.project.use.baseURL as string).origin;
  page.on("request", (request) => {
    if (!request.url().startsWith(localOrigin)) {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Preview in 3D" }).click();

  const preview = page.getByRole("region", {
    name: "3D preview of Living Room",
  });
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole("group", { name: "Sun study controls" }),
  ).toBeVisible();
  const timeSlider = preview.getByRole("slider", { name: "Local time of day" });
  await expect(timeSlider).toHaveValue("720");
  const canvas = preview.locator(".room-preview-canvas");
  await expect(canvas).toHaveAttribute("data-wimy-shadows", "on");
  await expect.poll(
    async () => Number(await canvas.getAttribute("data-wimy-sunbeams")),
  ).toBeGreaterThan(0);
  await canvas.screenshot({ path: testInfo.outputPath("sunlight-canvas-initial.png") });
  const status = preview.getByRole("status", { name: "Sun study status" });
  const initialStatus = await status.textContent();
  await preview.getByLabel("Plan North true bearing").fill("90");
  await expect(status).not.toHaveText(initialStatus ?? "");
  await expect(status).toContainText("Plan North 90°");
  await timeSlider.fill("480");
  await expect(preview).toContainText("Local 2026-09-01 08:00");
  await preview.getByRole("button", { name: "Play daylight" }).click();
  await expect.poll(() => timeSlider.inputValue()).not.toBe("480");
  await preview.getByRole("button", { name: "Pause daylight" }).click();
  await expect(canvas).toHaveAttribute("data-wimy-shadows", "on");
  await expect.poll(
    async () => Number(await canvas.getAttribute("data-wimy-sunbeams")),
  ).toBeGreaterThan(0);
  await expect(preview).toContainText("Approximate directional direct-sun geometry");
  await expect(preview).toContainText("does not estimate daylight intensity, lux, or energy performance");

  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share room", exact: true }).click();
  await page.getByRole("dialog", { name: "Share room" }).getByRole("button", {
    name: "Export .wimy",
  }).click();
  const download = await exported;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("expected a local Wimy download path");
  const portableText = await readFile(downloadPath, "utf8");
  expect(portableText).not.toContain("latitude");
  expect(portableText).not.toContain("longitude");
  expect(portableText).not.toContain("planNorthAzimuthDeg");
  await page.getByRole("button", { name: "Close share room" }).click();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(externalRequests).toEqual([]);

  const shadowToggle = preview.getByLabel("Enable bounded shadows");
  if (await shadowToggle.isEnabled()) {
    const shadowsOnFrameMs = await measureTwoAnimationFrames(page);
    await shadowToggle.uncheck();
    await expect(canvas).toHaveAttribute("data-wimy-shadows", "off");
    const shadowsOffFrameMs = await measureTwoAnimationFrames(page);
    console.log(
      JSON.stringify({ shadowsOffFrameMs, shadowsOnFrameMs }),
    );
    await testInfo.attach("sunlight-performance.json", {
      body: JSON.stringify({ shadowsOffFrameMs, shadowsOnFrameMs }),
      contentType: "application/json",
    });
    await shadowToggle.check();
  } else {
    await testInfo.attach("sunlight-performance.json", {
      body: JSON.stringify({ shadowsOffFrameMs: null, shadowsOnFrameMs: null }),
      contentType: "application/json",
    });
  }

  await canvas.screenshot({ path: testInfo.outputPath("sunlight-canvas.png") });
  await preview.screenshot({ path: testInfo.outputPath("sunlight-preview.png") });
});

test("fails closed instead of showing a plausible sun for invalid input", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview in 3D" }).click();
  const preview = page.getByRole("region", {
    name: "3D preview of Living Room",
  });
  await preview.getByLabel("Latitude").fill("91");
  await expect(
    preview.getByRole("status", { name: "Sun study status" }),
  ).toHaveText("Sun study unavailable. No fixed fallback sun is shown.");
});
