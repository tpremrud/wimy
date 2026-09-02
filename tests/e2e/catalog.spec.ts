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

  await expect(page.getByRole("button", { name: "Expand room tools" })).toBeVisible();
  const mobileCatalogPosition = await catalog.evaluate(
    (element) => getComputedStyle(element).position,
  );
  expect(mobileCatalogPosition).toBe("fixed");
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

test("imports a project-authored catalog package without fetching its metadata", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("/");

  const projectPackage = {
    format: "wimy-catalog",
    schemaVersion: 1,
    publisher: {
      publisherId: "00000000-0000-4000-8000-000000000301",
      name: "Wimy Project Studio",
    },
    catalog: {
      catalogId: "00000000-0000-4000-8000-000000000302",
      name: "Project Authored Browser Fixture",
      version: "2026.09.02",
      license: { name: "Wimy Project Authored License", spdxId: "MIT" },
      provenance: {
        sourceName: "Wimy Project Studio",
        sourceUrl: "https://wimy.example.invalid/catalog",
        observedAt: "2026-09-02T01:00:00-04:00",
      },
    },
    items: [
      {
        itemId: "00000000-0000-4000-8000-000000000303",
        name: "Aurora Browser Chair",
        variants: [
          {
            variantId: "00000000-0000-4000-8000-000000000304",
            snapshot: {
              name: "Aurora Browser Chair",
              category: "chair",
              dimensions: { width: 0.55, depth: 0.55, height: 0.8 },
              appearance: { color: "#76543A" },
              styleTags: ["project-authored"],
            },
            externalIdentifiers: [],
            classifications: [],
          },
        ],
      },
    ],
  };

  await page
    .getByLabel("Import project-authored catalog package")
    .setInputFiles({
      name: "project-authored.wimy-catalog",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(projectPackage)),
    });

  await expect(
    page.getByRole("status", { name: "Catalog import result" }),
  ).toContainText("Imported 1 project-authored catalog item: Aurora Browser Chair");
  await expect(page.getByText("Aurora Browser Chair", { exact: true })).toBeVisible();
  await expect(page.getByText("Wimy Project Studio · 2026.09.02")).toBeVisible();
});

test("shows synthetic offer evidence without exposing a purchase action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1")) {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/");

  const projectPackage = {
    format: "wimy-catalog",
    schemaVersion: 1,
    publisher: {
      publisherId: "00000000-0000-4000-8000-000000000301",
      name: "Wimy Project Studio",
    },
    catalog: {
      catalogId: "00000000-0000-4000-8000-000000000302",
      name: "Project Authored Browser Fixture",
      version: "2026.09.02",
      license: { name: "Wimy Project Authored License", spdxId: "MIT" },
      provenance: {
        sourceName: "Wimy Project Studio",
        sourceUrl: "https://wimy.example.invalid/catalog",
        observedAt: "2026-09-02T01:00:00-04:00",
      },
    },
    items: [
      {
        itemId: "00000000-0000-4000-8000-000000000303",
        name: "Aurora Browser Chair",
        variants: [
          {
            variantId: "00000000-0000-4000-8000-000000000304",
            snapshot: {
              name: "Aurora Browser Chair",
              category: "chair",
              dimensions: { width: 0.55, depth: 0.55, height: 0.8 },
              appearance: { color: "#76543A" },
              styleTags: ["project-authored"],
            },
            externalIdentifiers: [],
            classifications: [],
          },
        ],
      },
    ],
  };

  await page.getByLabel("Import project-authored catalog package").setInputFiles({
    name: "project-authored.wimy-catalog",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(projectPackage)),
  });
  await expect(
    page.getByRole("status", { name: "Catalog import result" }),
  ).toContainText("Aurora Browser Chair");
  await page
    .getByRole("button", { name: "Show offer evidence for Aurora Browser Chair" })
    .click();

  const evidence = page.getByRole("region", {
    name: "Offer evidence for Aurora Browser Chair",
  });
  await expect(evidence).toContainText("Northstar Furnishings");
  await expect(evidence).toContainText("Exact product");
  await expect(evidence).toContainText("Unverified candidate");
  await expect(evidence).toContainText("Stale evidence");
  await expect(evidence).toContainText("Unavailable");
  await expect(evidence).toContainText("Observed 2026-09-02T12:00:00.000Z");
  await expect(evidence).toContainText("offers.example.invalid");
  await expect(evidence.getByRole("button")).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test("builds a retailer-grouped shopping plan for a placed project-authored variant", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1")) externalRequests.push(request.url());
  });
  await page.goto("/");

  const projectPackage = {
    format: "wimy-catalog",
    schemaVersion: 1,
    publisher: {
      publisherId: "00000000-0000-4000-8000-000000000601",
      name: "Wimy Project Studio",
    },
    catalog: {
      catalogId: "00000000-0000-4000-8000-000000000602",
      name: "Project Authored Shopping Browser Fixture",
      version: "2026.09.02",
      license: { name: "Wimy Project Authored License", spdxId: "MIT" },
      provenance: {
        sourceName: "Wimy Project Studio",
        sourceUrl: "https://wimy.example.invalid/catalog",
        observedAt: "2026-09-02T01:00:00-04:00",
      },
    },
    items: [
      {
        itemId: "00000000-0000-4000-8000-000000000603",
        name: "Aurora Shopping Browser Chair",
        variants: [
          {
            variantId: "00000000-0000-4000-8000-000000000604",
            snapshot: {
              name: "Aurora Shopping Browser Chair",
              category: "chair",
              dimensions: { width: 0.55, depth: 0.55, height: 0.8 },
              appearance: { color: "#76543A" },
              styleTags: ["project-authored"],
            },
            externalIdentifiers: [],
            classifications: [],
          },
        ],
      },
    ],
  };

  await page.getByLabel("Import project-authored catalog package").setInputFiles({
    name: "shopping.wimy-catalog",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(projectPackage)),
  });
  await expect(page.getByRole("status", { name: "Catalog import result" })).toContainText(
    "Aurora Shopping Browser Chair",
  );
  await page.getByRole("combobox", { name: "Category" }).selectOption("chair");
  await page.getByText("More filters").click();
  await page.getByRole("textbox", { name: "Style tags" }).fill("project-authored");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect(page.getByRole("list", { name: "Catalog results" })).toContainText(
    "Aurora Shopping Browser Chair",
  );
  await page.getByRole("button", { name: "Add best fit" }).click();
  await expect(page.getByRole("region", { name: "Living Room" })).toContainText("Revision 2");
  await page.getByRole("button", { name: "Build room shopping plan" }).click();

  const plan = page.getByRole("region", { name: "Room shopping plan" });
  await expect(plan).toContainText("Northstar Furnishings");
  await expect(plan).toContainText("Elm Commons");
  await expect(plan).toContainText("Cheapest current comparable exact offer");
  await expect(plan).toContainText("Excluded from exact price ranking");
  await expect(plan).toContainText("delivery");
  await expect(plan.locator('a[href^="https://offers.example.invalid/"]')).not.toHaveCount(0);
  await expect(plan).not.toContainText(/purchase|checkout|cart/iu);
  expect(externalRequests).toEqual([]);
});
