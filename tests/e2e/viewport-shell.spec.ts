import { expect, test } from "@playwright/test";

const desktopViewports = [
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

for (const viewport of desktopViewports) {
  test(`owns the document viewport at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const assertNoDocumentScroll = async () => {
      await expect.poll(() => page.evaluate(() => ({
        scrollHeight: document.scrollingElement?.scrollHeight ?? -1,
        clientHeight: document.scrollingElement?.clientHeight ?? -1,
      }))).toEqual({ scrollHeight: viewport.height, clientHeight: viewport.height });
    };

    await assertNoDocumentScroll();
    await page.getByRole("button", { name: "Preview in 3D" }).click();
    await assertNoDocumentScroll();
    await page.getByRole("button", { name: "Share room" }).click();
    const share = page.getByRole("dialog", { name: "Share room" });
    await expect(share.getByRole("combobox", { name: "Load room template" })).toBeVisible();
    await expect(share.getByLabel("Import .wimy file")).toBeVisible();
    await expect(share.getByRole("button", { name: "Export .wimy" })).toBeVisible();
    await expect(share.getByRole("button", { name: "Undo last room change" })).toBeVisible();
    await assertNoDocumentScroll();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Help and agent guidance" }).click();
    await assertNoDocumentScroll();
    await page.keyboard.press("Escape");

    const rail = page.getByRole("complementary", { name: "Furniture catalog" });
    const railPanel = rail.locator(".rail-panel-host");
    await expect(railPanel).toHaveCSS("overflow-y", "auto");
    const room = page.getByRole("region", { name: "Living Room", exact: true });
    const expandedRailBox = await rail.boundingBox();
    const expandedRoomBox = await room.boundingBox();
    await page.getByRole("button", { name: "Collapse room tools" }).click();
    const collapsedRailBox = await rail.boundingBox();
    const collapsedRoomBox = await room.boundingBox();
    expect(collapsedRailBox?.width).toBeLessThan(expandedRailBox?.width ?? Infinity);
    expect(collapsedRoomBox?.width).toBeGreaterThan(expandedRoomBox?.width ?? 0);
    await page.getByRole("button", { name: "Expand room tools" }).click();
    await page.getByRole("tab", { name: "Favorites" }).click();
    await page.getByRole("tab", { name: "Placed" }).click();
    await assertNoDocumentScroll();
  });
}

test("keeps narrow room tools reachable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect.poll(() => page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? -1,
    clientWidth: document.scrollingElement?.clientWidth ?? -1,
  }))).toEqual({ scrollWidth: 390, clientWidth: 390 });
  await page.getByRole("button", { name: "Help and agent guidance" }).click();
  await expect(page.getByRole("dialog", { name: "Browser agent guidance" })).toBeVisible();
  await page.keyboard.press("Escape");
  const rail = page.getByRole("complementary", { name: "Furniture catalog" });
  await expect.poll(() => rail.locator(".rail-panel-host").evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  })).then(({ scrollHeight, clientHeight, overflowY }) => ({
    scrollHeight,
    clientHeight,
    overflowY,
    fits: scrollHeight <= clientHeight,
  }))).toMatchObject({ overflowY: "visible", fits: true });
  await page.getByRole("button", { name: "Collapse room tools" }).click();
  await expect(page.getByRole("button", { name: "Expand room tools" })).toBeVisible();
});
