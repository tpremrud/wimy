import { expect, test } from "@playwright/test";

test("shows all workspace rails at 1280 and stacks them on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("/");

  const catalog = page.getByRole("complementary", {
    name: "Furniture catalog",
  });
  const room = page.getByRole("region", { name: "Living Room" });
  const activity = page.getByRole("complementary", {
    name: "Activity receipts",
  });
  const desktopBoxes = await Promise.all([
    catalog.boundingBox(),
    room.boundingBox(),
    activity.boundingBox(),
  ]);
  const [desktopCatalog, desktopRoom, desktopActivity] = desktopBoxes;
  if (!desktopCatalog || !desktopRoom || !desktopActivity) {
    throw new Error("expected rendered desktop workspace regions");
  }

  expect(desktopCatalog.y).toBeLessThan(900);
  expect(desktopRoom.y).toBeLessThan(900);
  expect(desktopActivity.y).toBeLessThan(900);
  expect(Math.abs(desktopCatalog.y - desktopRoom.y)).toBeLessThan(2);
  expect(Math.abs(desktopRoom.y - desktopActivity.y)).toBeLessThan(2);
  expect(desktopCatalog.x + desktopCatalog.width).toBeLessThan(
    desktopRoom.x,
  );
  expect(desktopRoom.x + desktopRoom.width).toBeLessThan(desktopActivity.x);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBoxes = await Promise.all([
    catalog.boundingBox(),
    room.boundingBox(),
    activity.boundingBox(),
  ]);
  const [mobileCatalog, mobileRoom, mobileActivity] = mobileBoxes;
  if (!mobileCatalog || !mobileRoom || !mobileActivity) {
    throw new Error("expected rendered mobile workspace regions");
  }

  expect(mobileCatalog.y + mobileCatalog.height).toBeLessThan(mobileRoom.y);
  expect(mobileRoom.y + mobileRoom.height).toBeLessThan(mobileActivity.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});

test("searches the fictional catalog and adds its deterministic best fit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("/");

  await page.getByRole("combobox", { name: "Category" }).selectOption("chair");
  await page.getByRole("textbox", { name: "Style tags" }).fill("warm-modern");
  await page
    .getByRole("spinbutton", { name: "Maximum price (USD)" })
    .fill("600");
  await page.getByRole("button", { name: "Search catalog" }).click();

  const results = page.getByRole("list", { name: "Catalog results" });
  await expect(results).toContainText("Ember Nest Chair");
  await expect(results).toContainText("$499 USD");
  await expect(results).toContainText(
    "Best fit: x 0.3 m, y 0.3 m, rotation 0°",
  );

  await page.getByRole("button", { name: "Add best fit" }).click();

  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 2");
  await expect(
    page.getByRole("button", { name: "Select Ember Nest Chair" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("HumanAcceptedAdded Ember Nest ChairRevision 2");
  await expect(page.getByRole("status").filter({ hasText: "Accepted:" }))
    .toHaveText("Accepted: Added Ember Nest Chair. Revision 2.");
  await expect(
    page.getByRole("status", { name: "Catalog search result" }),
  ).toHaveText(
    "Search 1 results refreshed: 2 matches. Best match: Ember Nest Chair at x 0.9 m, y 0.3 m, rotation 0°.",
  );
});
