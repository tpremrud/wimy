import { expect, test } from "@playwright/test";

test("keeps the room dominant and stacks secondary surfaces on mobile", async ({
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
  expect(Math.abs(desktopCatalog.y - desktopRoom.y)).toBeLessThan(2);
  expect(desktopCatalog.x + desktopCatalog.width).toBeLessThan(
    desktopRoom.x,
  );
  expect(desktopActivity.x).toBe(desktopRoom.x);
  expect(desktopActivity.y).toBeGreaterThan(desktopRoom.y + desktopRoom.height - 2);
  expect(desktopRoom.width).toBeGreaterThan(desktopCatalog.width * 2);

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

  expect(mobileRoom.y).toBeLessThan(mobileCatalog.y);
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
  await page.getByText("More filters").click();
  await page
    .getByRole("textbox", { name: "Style tags" })
    .fill("molded-shell, lounge");
  await page
    .getByRole("spinbutton", { name: "Maximum price (USD)" })
    .fill("579");
  await page.getByRole("button", { name: "Search catalog" }).click();

  const results = page.getByRole("list", { name: "Catalog results" });
  await expect(results).toContainText("Dune Shell Lounger");
  await expect(results).toContainText("Styles: organic, molded-shell, lounge");
  await expect(results).toContainText("$579 USD");
  await expect(results).toContainText(
    "Best fit: x 0.5 m, y 0.5 m, rotation 0°",
  );

  await page.getByRole("button", { name: "Add best fit" }).click();

  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 2");
  await expect(
    page.getByRole("button", { name: "Select Dune Shell Lounger" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Human: Accepted. Added Dune Shell LoungerRevision 2");
  await expect(page.getByRole("status").filter({ hasText: "Accepted:" }))
    .toHaveText("Accepted: Added Dune Shell Lounger. Revision 2.");
  await expect(
    page.getByRole("status", { name: "Catalog search result" }),
  ).toHaveText(
    "Search 1 results refreshed: 1 match. Best match: Dune Shell Lounger at x 3.8 m, y 1.3 m, rotation 0°.",
  );
});
