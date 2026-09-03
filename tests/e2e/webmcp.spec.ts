import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

type HarnessTool = {
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => unknown | Promise<unknown>;
};

type ModelContextHarness = {
  tools: Record<string, HarnessTool>;
  registrationCalls: string[];
  abortedRegistrations: string[];
};

const installModelContextHarness = async (page: Page) => {
  await page.addInitScript(() => {
    const harness: ModelContextHarness = {
      tools: {},
      registrationCalls: [],
      abortedRegistrations: [],
    };
    Object.defineProperty(window, "__wimyModelContextHarness", {
      configurable: true,
      value: harness,
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (
          tool: HarnessTool & { name: string },
          options?: { signal?: AbortSignal },
        ) => {
          harness.tools[tool.name] = tool;
          harness.registrationCalls.push(tool.name);
          options?.signal?.addEventListener(
            "abort",
            () => {
              delete harness.tools[tool.name];
              harness.abortedRegistrations.push(tool.name);
            },
            { once: true },
          );
        },
        getTools: async () => [],
        ontoolchange: null,
      },
    });
  });
};

const callTool = async (
  page: Page,
  name: string,
  input: Record<string, unknown>,
) =>
  page.evaluate(
    async ({ toolName, toolInput }) => {
      const harness = (
        window as typeof window & {
          __wimyModelContextHarness: ModelContextHarness;
        }
      ).__wimyModelContextHarness;
      const tool = harness.tools[toolName];
      if (!tool) throw new Error(`${toolName} is not registered`);

      return tool.execute(toolInput, {
        signal: new AbortController().signal,
      });
    },
    { toolName: name, toolInput: input },
  );

const projectAuthoredCartPackage = {
  format: "wimy-catalog",
  schemaVersion: 1,
  provider: {
    providerId: "00000000-0000-4000-8000-000000000405",
    name: "Northstar Home",
    connection: "not_connected",
  },
  publisher: {
    publisherId: "00000000-0000-4000-8000-000000000401",
    name: "Wimy Cart Fixture Studio",
  },
  catalog: {
    catalogId: "00000000-0000-4000-8000-000000000402",
    name: "Project Authored Cart Fixture",
    version: "2026.09.02",
    license: { name: "Wimy Project Authored License", spdxId: "MIT" },
    provenance: {
      sourceName: "Wimy Cart Fixture Studio",
      sourceUrl: "https://wimy.example.invalid/cart-fixture",
      observedAt: "2026-09-02T01:00:00-04:00",
    },
  },
  items: [
    {
      itemId: "00000000-0000-4000-8000-000000000403",
      name: "Aurora Browser Chair",
      variants: [
        {
          variantId: "00000000-0000-4000-8000-000000000404",
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
} as const;

test("inspect, find, and apply visibly collaborate while stale edits recover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 720 });
  await installModelContextHarness(page);
  await page.goto("/");

  await expect(
    page.getByRole("status", { name: "WebMCP status" }),
  ).toContainText(
    "WebMCP ready — 9 tools registered",
  );
  const toolsTrigger = page.getByRole("button", {
    name: "WebMCP tools, 9 registered",
  });
  await expect(toolsTrigger).toHaveText("WebMCP · 9 tools");
  await toolsTrigger.click();
  const toolsPanel = page.getByRole("dialog", { name: "WebMCP tools" });
  await expect(toolsPanel).toContainText("9 of 9 registered");
  await expect(toolsPanel.getByText("inspect_room", { exact: true })).toBeVisible();
  await expect(toolsPanel.getByText("find_furniture")).toBeVisible();
  await expect(toolsPanel.getByText("apply_room_edit")).toBeVisible();
  await expect(toolsPanel.getByText("apply_room_structure_edit")).toBeVisible();
  await expect(toolsPanel.getByText("inspect_retailer_offers")).toBeVisible();
  await expect(toolsPanel.getByText("inspect_room_shopping_plan")).toBeVisible();
  await expect(toolsPanel.getByText("find_substitutes")).toBeVisible();
  await expect(toolsPanel.getByText("inspect_lighting_preview")).toBeVisible();
  await expect(toolsPanel.getByText("set_lighting_preview")).toBeVisible();
  await expect(toolsPanel.getByText("Can change room")).toHaveCount(3);
  await expect(toolsPanel.getByText("Available after sign-in")).toBeVisible();
  await expect(
    toolsPanel.getByRole("list", { name: "WebMCP tools available after sign-in" }),
  ).toContainText("inspect_cart");
  await page.keyboard.press("Escape");
  await expect(toolsPanel).toBeHidden();
  await expect(toolsTrigger).toBeFocused();
  const discovered = await page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __wimyModelContextHarness: ModelContextHarness;
      }
    ).__wimyModelContextHarness;
    return {
      activeNames: Object.keys(harness.tools).sort(),
      registrationCount: harness.registrationCalls.length,
    };
  });
  expect(discovered.activeNames).toEqual([
    "apply_room_edit",
    "apply_room_structure_edit",
    "find_furniture",
    "find_substitutes",
    "inspect_lighting_preview",
    "inspect_retailer_offers",
    "inspect_room",
    "inspect_room_shopping_plan",
    "set_lighting_preview",
  ]);
  expect(discovered.registrationCount).toBe(9);
  const pageUrlBeforeReadOnlyTools = page.url();
  const pageCountBeforeReadOnlyTools = page.context().pages().length;

  const inspected = await callTool(page, "inspect_room", {});
  expect(inspected).toMatchObject({
    revision: 1,
    units: "meters",
    coordinateConvention: {
      origin: "northwest interior floor corner",
      xAxis: "east/right",
      yAxis: "south/down",
    },
    room: {
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "item_living_sofa",
          pose: { x: 2.4, y: 0.55, rotationDeg: 180 },
          orientation: expect.objectContaining({
            cue: "facing",
            direction: "south",
            label: "Facing south",
            rotationDeg: 180,
          }),
        }),
      ]),
    },
    warningCount: 0,
    warningsTruncated: false,
  });

  const found = (await callTool(page, "find_furniture", {
    category: "chair",
    styleTags: ["warm-modern"],
    maxPrice: 600,
    limit: 1,
  })) as {
    revision: number;
    units: "meters";
    matches: Array<{
      catalogId: string;
      productId: string;
      name: string;
      suggestedPose: { x: number; y: number; rotationDeg: 0 | 90 | 180 | 270 };
    }>;
  };
  expect(found).toMatchObject({
    revision: 1,
    units: "meters",
    matches: [
      {
        catalogId: "wimy-demo-v1",
        productId: "ember-nest-chair",
        name: "Ember Nest Chair",
        suggestedPose: { x: 0.3, y: 0.3, rotationDeg: 0 },
      },
    ],
  });
  expect(Object.keys(found)).toEqual(["revision", "units", "matches"]);
  expect(JSON.stringify(found)).not.toMatch(/https?:\/\/|<\/?[a-z]/iu);
  expect(page.url()).toBe(pageUrlBeforeReadOnlyTools);
  expect(page.context().pages()).toHaveLength(pageCountBeforeReadOnlyTools);
  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 1");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem"),
  ).toHaveCount(0);

  const match = found.matches[0];
  if (!match) throw new Error("expected a deterministic furniture match");

  const applied = await callTool(page, "apply_room_edit", {
    expectedRevision: found.revision,
    operations: [
      {
        type: "add",
        productId: match.productId,
        pose: match.suggestedPose,
      },
    ],
  });
  expect(applied).toMatchObject({
    ok: true,
    revision: 2,
    applied: 1,
    warnings: [],
    warningCount: 0,
    warningsTruncated: false,
  });
  const addedItemId = (applied as { itemIds: string[] }).itemIds[0];
  expect(addedItemId).toMatch(/^item_[A-Fa-f0-9-]+$/u);
  const substitutes = (await callTool(page, "find_substitutes", {
    itemId: addedItemId,
    limit: 3,
  })) as {
    ok: boolean;
    revision: number;
    matches: Array<{
      name: string;
      actionable: boolean;
      rationale: string;
      tradeoffs: string[];
    }>;
  };
  expect(substitutes).toMatchObject({ ok: true, revision: 2 });
  expect(substitutes.matches.length).toBeGreaterThan(0);
  expect(substitutes.matches[0]).toMatchObject({
    actionable: true,
    rationale: expect.any(String),
    tradeoffs: expect.any(Array),
  });
  expect(JSON.stringify(substitutes)).not.toMatch(/price|https?:\/\//iu);
  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 2");
  await expect(
    page.getByRole("button", { name: "Select Ember Nest Chair" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select Ember Nest Chair" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Selected item actions"))
    .toContainText("Facing north · 0° · x 0.3 m, y 0.3 m");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Agent: Accepted. Added Ember Nest ChairRevision 2");
  await expect(
    page.getByRole("complementary", { name: "Activity receipts" }),
  ).toHaveAttribute("inert");

  await page.getByRole("button", { name: "Rotate 90 degrees" }).click();

  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 3");
  await expect(page.getByLabel("Selected item actions"))
    .toContainText("Facing east · 90° · x 0.3 m, y 0.3 m");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Human: Accepted. Applied 1 room operationsRevision 3");
  await expect(page.getByLabel("Human edit result")).toHaveText(
    "Human edit attempt 1 accepted. Applied 1 room operations. Revision 3.",
  );

  const stale = await callTool(page, "apply_room_edit", {
    expectedRevision: 2,
    operations: [
      {
        type: "transform",
        itemId: "item_living_sofa",
        pose: { x: 2.2, y: 0.6, rotationDeg: 0 },
      },
    ],
  });
  expect(stale).toEqual({
    ok: false,
    revision: 3,
    code: "REVISION_CONFLICT",
    message: "Expected revision 2, but the room is at revision 3",
  });
  await expect(
    page.getByRole("region", { name: "Activity receipts" }).getByRole(
      "listitem",
    ).first(),
  ).toContainText(
    "Agent: Rejected. Expected revision 2, but the room is at revision 3Revision 3",
  );

  const refreshed = (await callTool(page, "inspect_room", {})) as {
    revision: number;
  };
  expect(refreshed.revision).toBe(3);
  const retried = await callTool(page, "apply_room_edit", {
    expectedRevision: refreshed.revision,
    operations: [
      {
        type: "transform",
        itemId: "item_living_sofa",
        pose: { x: 2.2, y: 0.6, rotationDeg: 0 },
      },
    ],
  });
  expect(retried).toMatchObject({ ok: true, revision: 4, applied: 1 });
  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 4");
  await page
    .getByRole("button", { name: "Select Linen Apartment Sofa" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Selected item actions"),
  ).toContainText("Facing north · 0° · x 2.2 m, y 0.6 m");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Agent: Accepted. Applied 1 room operationsRevision 4");

  const editorItemCount = await page.locator(".room-item").count();
  await page.getByRole("button", { name: "Preview in 3D" }).click();
  const preview = page.getByRole("region", {
    name: "3D preview of Living Room",
  });
  await expect(preview).toBeVisible();
  await expect(
    preview
      .getByRole("list", { name: "Placed items in Living Room" })
      .getByRole("listitem"),
  ).toHaveCount(editorItemCount);
  await expect(preview).toContainText("Ember Nest Chair");

  await page.getByRole("tab", { name: "Placed" }).click();
  const placedPanel = page.getByRole("tabpanel", { name: "Placed" });
  await placedPanel
    .getByRole("button", { name: "Find substitutes for Ember Nest Chair" })
    .click();
  const substitutesPanel = page.getByRole("region", {
    name: "Substitutes for Ember Nest Chair",
  });
  await expect(substitutesPanel).toContainText(
    "is a comparable substitute for Ember Nest Chair",
  );
  await substitutesPanel.getByRole("button", { name: /^Replace Ember Nest Chair with /u }).first().click();
  await expect(
    page.getByRole("region", { name: "Living Room", exact: true }),
  ).toContainText("Revision 5");
  await expect(page.getByRole("status").filter({ hasText: "Accepted: Replaced" })).toBeVisible();

  const registrationCountAfterEdits = await page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __wimyModelContextHarness: ModelContextHarness;
      }
    ).__wimyModelContextHarness;
    return harness.registrationCalls.length;
  });
  expect(registrationCountAfterEdits).toBe(9);
});

test("set_lighting_preview synchronizes the timeline and window light without resetting orbit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await installModelContextHarness(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Preview in 3D" }).click();

  const preview = page.getByRole("region", {
    name: "3D preview of Living Room",
  });
  const canvas = preview.locator(".room-preview-canvas canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-wimy-camera-position", /.+/u);
  const initialCamera = await canvas.getAttribute("data-wimy-camera-position");
  if (!initialCamera) throw new Error("expected initial orbit diagnostics");
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("expected a visible 3D canvas");
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.7, canvasBox.y + canvasBox.height * 0.42, { steps: 8 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("data-wimy-camera-position", initialCamera);
  const userOrbitCamera = await canvas.getAttribute("data-wimy-camera-position");
  if (!userOrbitCamera) throw new Error("expected user orbit diagnostics");
  const timeline = preview.getByRole("slider", { name: "Local time of day" });
  await expect(timeline).toHaveValue("720");
  await preview.getByRole("button", { name: "Open lighting settings" }).click();
  await expect(preview.getByRole("status", { name: "Sun study status" })).toContainText(
    "Direct sun is above the modeled horizon",
  );
  const lightingSurface = preview.locator(".room-preview-canvas");
  await expect(lightingSurface).toHaveAttribute("data-wimy-sunbeams", /[1-9]/u);

  const inspected = (await callTool(page, "inspect_lighting_preview", {})) as {
    revision: number;
  };
  expect(inspected.revision).toBe(1);
  const accepted = await callTool(page, "set_lighting_preview", {
    expectedLightingRevision: inspected.revision,
    minuteOfDay: 0,
  });
  expect(accepted).toMatchObject({ ok: true, revision: 2 });

  await expect(timeline).toHaveValue("0");
  await expect(preview.getByRole("status", { name: "Sun study status" })).toContainText(
    "Direct sun is at or below the modeled horizon",
  );
  await expect(lightingSurface).toHaveAttribute("data-wimy-sunbeams", "0");
  await expect(canvas).toHaveAttribute("data-wimy-camera-position", userOrbitCamera);
  await expect(page.getByRole("region", { name: "Living Room", exact: true })).toContainText(
    "Revision 1",
  );
  await expect(page.getByRole("region", { name: "Activity receipts" }).getByRole("listitem")).toHaveCount(0);
  await expect.poll(async () => (await callTool(page, "inspect_lighting_preview", {})) as { revision: number }).toMatchObject({ revision: 2 });
});

test("applies atomic room structure edits across 2D, 3D, receipt, export, and reinspection", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_280, height: 720 });
  await installModelContextHarness(page);
  await page.goto("/");

  const inspectedBefore = (await callTool(page, "inspect_room", {})) as {
    revision: number;
  };
  expect(inspectedBefore.revision).toBe(1);

  const applied = await callTool(page, "apply_room_structure_edit", {
    expectedRevision: inspectedBefore.revision,
    name: "Hong Kong Studio",
    dimensions: { width: 5.2 },
    geometry: {
      shape: "l-shape",
      notch: { corner: "south-east", width: 1, depth: 1 },
    },
    openingOperations: [
      {
        type: "add",
        opening: {
          id: "opening_agent_south_window",
          kind: "window",
          wall: "south",
          centerOffset: 2.5,
          width: 1.1,
          bottom: 0.9,
          height: 1.2,
        },
      },
    ],
  });
  expect(applied).toMatchObject({
    ok: true,
    revision: 2,
    applied: 1,
    receipt: {
      origin: "webmcp",
      status: "accepted",
      revision: 2,
      changeType: "structure",
      affectedOpeningIds: ["opening_agent_south_window"],
    },
  });

  await expect(page.getByLabel("Current room context")).toContainText("Hong Kong Studio");
  await expect(page.getByLabel("Current room context")).toContainText("Revision 2");
  await expect(page.locator(".room-boundary")).toHaveAttribute(
    "points",
    /^(?:[^ ]+ ){5}[^ ]+$/u,
  );
  await expect(
    page.getByRole("region", { name: "Activity receipts" }).getByRole("listitem").first(),
  ).toContainText("Agent: Accepted. Updated room structure");

  await page.getByRole("button", { name: "Preview in 3D" }).click();
  const preview = page.getByRole("region", { name: "3D preview of Hong Kong Studio" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("5.2 m by 4.2 m");
  await expect(
    preview.getByRole("list", { name: "Placed items in Hong Kong Studio" }).getByRole("listitem"),
  ).toHaveCount(5);

  await page.getByRole("button", { name: "Share room", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share room" });
  const downloadPromise = page.waitForEvent("download");
  await share.getByRole("button", { name: "Export .wimy" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("hong-kong-studio.wimy");
  const exportPath = testInfo.outputPath("structure-edit.wimy");
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, "utf8")) as {
    schemaVersion: number;
    room: {
      name: string;
      dimensions: { width: number };
      geometry: { shape: string };
      openings: Array<{ id: string }>;
    };
  };
  expect(exported).toMatchObject({
    schemaVersion: 2,
    room: {
      name: "Hong Kong Studio",
      dimensions: { width: 5.2 },
      geometry: { shape: "l-shape" },
      openings: expect.arrayContaining([
        expect.objectContaining({ id: "opening_agent_south_window" }),
      ]),
    },
  });

  const inspectedAfter = await callTool(page, "inspect_room", {});
  expect(inspectedAfter).toMatchObject({
    revision: 2,
    room: {
      name: "Hong Kong Studio",
      dimensions: { width: 5.2 },
      geometry: { shape: "l-shape" },
      openings: expect.arrayContaining([
        expect.objectContaining({ id: "opening_agent_south_window", wall: "south" }),
      ]),
    },
  });
});

test("the room remains functional without modelContext", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("status", { name: "WebMCP status" }),
  ).toContainText(
    "WebMCP unavailable — human room access remains available",
  );
  await expect(page.getByRole("heading", { name: "Living Room" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 1");

  await page
    .getByRole("button", { name: "Select Soft Lounge Chair" })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Rotate 90 degrees" }).click();

  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 2");
  await expect(page.getByLabel("Selected item actions"))
    .toContainText("Facing south · 180°");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Human: Accepted. Applied 1 room operationsRevision 2");
});

test("exposes authenticated cart tools, keeps room state separate, and unregisters them on sign-out", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await installModelContextHarness(page);
  await page.clock.install({ time: new Date("2026-09-02T12:05:00.000Z") });
  await page.goto("/");

  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 9 tools registered",
  );
  await page.getByRole("button", { name: "Sign in (optional)" }).click();
  await page.getByRole("button", { name: "Continue locally" }).click();
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 13 tools registered",
  );
  await page.getByRole("button", { name: "WebMCP tools, 13 registered" }).click();
  const authenticatedToolsPanel = page.getByRole("dialog", { name: "WebMCP tools" });
  await expect(authenticatedToolsPanel.getByText("inspect_cart")).toBeVisible();
  await expect(authenticatedToolsPanel.getByText("Available after sign-in")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByLabel("Import project-authored catalog package").setInputFiles({
    name: "cart-fixture.wimy-catalog",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(projectAuthoredCartPackage)),
  });
  await expect(page.getByRole("status", { name: "Catalog import result" })).toContainText(
    "Imported 1 project-authored catalog item: Aurora Browser Chair",
  );
  await page.getByRole("button", { name: "Add Aurora Browser Chair to room" }).click();

  const initialRoom = (await callTool(page, "inspect_room", {})) as { revision: number };
  const initialCart = (await callTool(page, "inspect_cart", {})) as {
    ok: boolean;
    cart: { revision: number; lines: unknown[] };
  };
  expect(initialRoom.revision).toBe(2);
  expect(initialCart).toMatchObject({ ok: true, cart: { revision: 1, lines: [] } });

  const found = (await callTool(page, "find_retailer_offers", {
    catalogId: projectAuthoredCartPackage.catalog.catalogId,
    productId: projectAuthoredCartPackage.items[0]!.variants[0]!.variantId,
  })) as {
    ok: boolean;
    catalogRef: { catalogId: string; productId: string };
    offers: Array<{
      offerId: string;
      offerVersion: string;
      price: { amountMinor: number; currency: string };
    }>;
  };
  expect(found.ok).toBe(true);
  expect(found.offers.length).toBeGreaterThan(0);
  expect(JSON.stringify(found)).not.toMatch(/https?:\/\/|seller|sourceUrl|csrf|session-token/iu);
  const offer = found.offers[0]!;

  const added = (await callTool(page, "add_to_cart", {
    expectedRevision: initialCart.cart.revision,
    idempotencyKey: "browser-add-aurora",
    offer: {
      offerId: offer.offerId,
      offerVersion: offer.offerVersion,
      catalogRef: found.catalogRef,
      price: offer.price,
    },
  })) as { ok: boolean; cart: { revision: number; lines: Array<{ lineId: string }> } };
  await page.getByRole("button", { name: "Review shopping plan" }).click();
  const cartDialog = page.getByRole("dialog", { name: "Shopping plan" });
  expect(added).toMatchObject({
    ok: true,
    cart: { revision: 2, lines: [{ lineId: expect.any(String) }] },
    receipt: {
      origin: "webmcp",
      operation: "add",
      status: "accepted",
      revision: 2,
      target: {
        displayName: "Aurora Browser Chair",
        retailer: "Northstar Home",
      },
    },
  });
  await expect(cartDialog).toContainText("Aurora Browser Chair");
  await expect(
    cartDialog
      .getByRole("region", { name: "Plan for Northstar Home" })
      .getByRole("img", { name: "Aurora Browser Chair preview" }),
  ).toBeVisible();
  await expect(cartDialog.getByLabel("Cart revision 2")).toBeVisible();
  await expect(cartDialog).toContainText(
    "Latest mutation: webmcp · add · accepted · Cart rev 2 · Aurora Browser Chair · Northstar Home",
  );
  await expect(cartDialog.getByRole("region", { name: "Plan for Northstar Home" })).toBeVisible();
  await expect(cartDialog.getByRole("button", { name: "Checkout at Northstar Home — not connected" })).toBeDisabled();
  await expect(cartDialog).toContainText("Provider connection not available yet.");
  await page.screenshot({ path: testInfo.outputPath("provider-shopping-plan.png") });
  expect(await page.evaluate(() => Object.keys((window as typeof window & { __wimyModelContextHarness: ModelContextHarness }).__wimyModelContextHarness.tools))).not.toContain("confirm_checkout");
  expect(await page.locator("body").innerText()).not.toMatch(/order placed|payment completed|purchase successful/iu);
  expect((await callTool(page, "inspect_room", {}))).toMatchObject({ revision: 2 });

  const lineId = added.cart.lines[0]!.lineId;
  await expect(
    callTool(page, "remove_from_cart", {
      expectedRevision: 2,
      idempotencyKey: "browser-remove-aurora",
      lineId,
    }),
  ).resolves.toMatchObject({
    ok: true,
    cart: { revision: 3, lines: [] },
    receipt: {
      origin: "webmcp",
      operation: "remove",
      status: "accepted",
      revision: 3,
      target: {
        displayName: "Aurora Browser Chair",
        retailer: "Northstar Home",
      },
    },
  });
  await expect(cartDialog).toContainText("No provider selections yet.");
  await expect(cartDialog).toContainText(
    "Latest mutation: webmcp · remove · accepted · Cart rev 3 · Aurora Browser Chair · Northstar Home",
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 9 tools registered",
  );
  await expect.poll(async () =>
    page.evaluate(() => Object.keys(window.__wimyModelContextHarness.tools).sort()),
  ).toEqual([
    "apply_room_edit",
    "apply_room_structure_edit",
    "find_furniture",
    "find_substitutes",
    "inspect_lighting_preview",
    "inspect_retailer_offers",
    "inspect_room",
    "inspect_room_shopping_plan",
    "set_lighting_preview",
  ]);
  await expect(callTool(page, "inspect_cart", {})).rejects.toThrow("inspect_cart is not registered");
});

test("refreshes session scope at natural expiry and unregisters commerce tools", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-02T12:00:00.000Z") });
  await installModelContextHarness(page);
  await page.goto("/");

  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 9 tools registered",
  );
  await page.getByRole("button", { name: "Sign in (optional)" }).click();
  await page.getByRole("button", { name: "Continue locally" }).click();
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 13 tools registered",
  );

  await page.clock.runFor("30:01");
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 9 tools registered",
  );
  await expect(page.getByRole("region", { name: "Customer session" })).toContainText(
    "Anonymous mode",
  );
  await expect.poll(async () =>
    page.evaluate(() => Object.keys(window.__wimyModelContextHarness.tools).sort()),
  ).toEqual([
    "apply_room_edit",
    "apply_room_structure_edit",
    "find_furniture",
    "find_substitutes",
    "inspect_lighting_preview",
    "inspect_retailer_offers",
    "inspect_room",
    "inspect_room_shopping_plan",
    "set_lighting_preview",
  ]);
});
