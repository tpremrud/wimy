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

test("keeps floating header surfaces inset and dismisses them outside", async ({ page }) => {
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await page.goto("/");

  const headerBox = await page.locator(".app-header").boundingBox();
  if (!headerBox) throw new Error("expected the app header");

  const surfaces = [
    {
      trigger: page.getByRole("button", { name: "Share room" }),
      surface: () => page.getByRole("dialog", { name: "Share room" }),
    },
    {
      trigger: page.getByRole("button", { name: "Help and agent guidance" }),
      surface: () => page.getByRole("dialog", { name: "Browser agent guidance" }),
    },
    {
      trigger: page.getByRole("button", { name: "Warnings & activity" }),
      surface: () => page.getByRole("complementary", { name: "Activity receipts" }),
    },
  ] as const;

  for (const { trigger, surface: getSurface } of surfaces) {
    await trigger.click();
    const surface = getSurface();
    await expect(surface).toBeVisible();

    const geometry = await surface.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        borderRadius: styles.borderRadius,
        paddingTop: Number.parseFloat(styles.paddingTop),
        rightInset: window.innerWidth - rect.right,
        top: rect.top,
      };
    });
    expect(geometry.borderRadius).toBe("12px");
    expect(geometry.paddingTop).toBeGreaterThanOrEqual(16);
    expect(geometry.rightInset).toBeGreaterThanOrEqual(16);
    expect(geometry.top).toBeGreaterThanOrEqual(headerBox.y + headerBox.height + 8);
    expect(geometry.top).toBeLessThanOrEqual(headerBox.y + headerBox.height + 24);

    await page.getByRole("heading", { name: "Living Room", exact: true }).click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

test("keeps selected-item controls on the canvas without opening Placed", async ({ page }) => {
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await page.goto("/");

  await page
    .getByRole("button", { name: "Select Linen Apartment Sofa" })
    .click();

  const toolbar = page.getByRole("group", { name: "Selected item actions" });
  const plan = page.getByRole("group", { name: "Living Room 2D room editor" });
  await expect(toolbar).toBeVisible();
  await expect(page.getByRole("tab", { name: "Add" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const [toolbarBox, planBox] = await Promise.all([
    toolbar.boundingBox(),
    plan.boundingBox(),
  ]);
  if (!toolbarBox || !planBox) {
    throw new Error("expected the room plan and selected-item toolbar");
  }
  const toolbarCenter = toolbarBox.x + toolbarBox.width / 2;
  const planCenter = planBox.x + planBox.width / 2;
  expect(Math.abs(toolbarCenter - planCenter)).toBeLessThanOrEqual(2);
  expect(toolbarBox.y).toBeGreaterThan(planBox.y + 12);
  expect(toolbarBox.y + toolbarBox.height).toBeLessThan(planBox.y + planBox.height - 12);
  await expect.poll(() => page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }))).toEqual({ clientHeight: viewport.height, scrollHeight: viewport.height });
});

test("keeps browsing and search inside the desktop room-tools rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  const railPanel = page
    .getByRole("complementary", { name: "Furniture catalog" })
    .locator(".rail-panel-host");
  await expect.poll(() => railPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))).toMatchObject({
    clientHeight: expect.any(Number),
    scrollHeight: expect.any(Number),
  });
  const initialGeometry = await railPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(initialGeometry.scrollHeight).toBeLessThanOrEqual(
    initialGeometry.clientHeight,
  );

  await page.getByRole("combobox", { name: "Category" }).selectOption("sofa");
  await expect(page.getByRole("list", { name: "Available catalog items" }))
    .toContainText("Hearthline Sofa");
  const categoryGeometry = await railPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(categoryGeometry.scrollHeight).toBeLessThanOrEqual(
    categoryGeometry.clientHeight,
  );

  await page.getByRole("combobox", { name: "Category" }).selectOption("");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect(page.getByRole("list", { name: "Catalog results" }))
    .toBeVisible();
  const searchGeometry = await railPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(searchGeometry.scrollHeight).toBeLessThanOrEqual(
    searchGeometry.clientHeight,
  );
});

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

test("keeps floating surfaces clear of wrapped header controls", async ({ page }) => {
  for (const width of [1024, 1121, 1180, 1280, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const header = page.locator(".app-header");
    const surfaces = [
      {
        trigger: page.getByRole("button", { name: "Share room" }),
        surface: () => page.getByRole("dialog", { name: "Share room" }),
      },
      {
        trigger: page.getByRole("button", { name: "Help and agent guidance" }),
        surface: () => page.getByRole("dialog", { name: "Browser agent guidance" }),
      },
      {
        trigger: page.getByRole("button", { name: "Warnings & activity" }),
        surface: () => page.getByRole("complementary", { name: "Activity receipts" }),
      },
    ] as const;

    for (const { trigger, surface: getSurface } of surfaces) {
      await trigger.click();
      const surface = getSurface();
      await expect(surface).toBeVisible();
      const [headerBox, surfaceBox] = await Promise.all([
        header.boundingBox(),
        surface.boundingBox(),
      ]);
      if (!headerBox || !surfaceBox) {
        throw new Error("expected the app header and floating surface");
      }
      expect(
        surfaceBox.y,
        `floating surface should clear the header at ${width}px`,
      ).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
  }
});

test("keeps the inactive Share trigger behind mobile overlays", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const shareTrigger = page.getByRole("button", { name: "Share room" });
  const overlays = [
    {
      name: "help",
      trigger: page.getByRole("button", { name: "Help and agent guidance" }),
      surface: () => page.getByRole("dialog", { name: "Browser agent guidance" }),
    },
    {
      name: "activity",
      trigger: page.getByRole("button", { name: "Warnings & activity" }),
      surface: () => page.getByRole("complementary", { name: "Activity receipts" }),
    },
  ] as const;

  for (const { name, trigger, surface: getSurface } of overlays) {
    await trigger.click();
    const surface = getSurface();
    await expect(surface).toBeVisible();
    const [shareBox, surfaceBox] = await Promise.all([
      shareTrigger.boundingBox(),
      surface.boundingBox(),
    ]);
    if (!shareBox || !surfaceBox) {
      throw new Error("expected the Share trigger and mobile overlay");
    }
    const intersection = {
      left: Math.max(shareBox.x, surfaceBox.x),
      right: Math.min(shareBox.x + shareBox.width, surfaceBox.x + surfaceBox.width),
      top: Math.max(shareBox.y, surfaceBox.y),
      bottom: Math.min(shareBox.y + shareBox.height, surfaceBox.y + surfaceBox.height),
    };
    expect(intersection.right).toBeGreaterThan(intersection.left);
    expect(intersection.bottom).toBeGreaterThan(intersection.top);
    const topSurface = await page.evaluate(({ x, y }) => (
      document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-floating-surface]")
        ?.dataset.floatingSurface ?? null
    ), {
      x: (intersection.left + intersection.right) / 2,
      y: (intersection.top + intersection.bottom) / 2,
    });
    expect(topSurface).toBe(name);
    await page.keyboard.press("Escape");
  }
});
