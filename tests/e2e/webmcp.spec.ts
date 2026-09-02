import { expect, test, type Page } from "@playwright/test";

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
    "WebMCP ready — 6 tools registered",
  );
  const toolsTrigger = page.getByRole("button", {
    name: "WebMCP tools, 6 registered",
  });
  await expect(toolsTrigger).toHaveText("WebMCP · 6 tools");
  await toolsTrigger.click();
  const toolsPanel = page.getByRole("dialog", { name: "WebMCP tools" });
  await expect(toolsPanel).toContainText("6 of 6 registered");
  await expect(toolsPanel.getByText("inspect_room", { exact: true })).toBeVisible();
  await expect(toolsPanel.getByText("find_furniture")).toBeVisible();
  await expect(toolsPanel.getByText("apply_room_edit")).toBeVisible();
  await expect(toolsPanel.getByText("inspect_retailer_offers")).toBeVisible();
  await expect(toolsPanel.getByText("inspect_room_shopping_plan")).toBeVisible();
  await expect(toolsPanel.getByText("find_substitutes")).toBeVisible();
  await expect(toolsPanel.getByText("Can change room")).toBeVisible();
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
    "find_furniture",
    "find_substitutes",
    "inspect_retailer_offers",
    "inspect_room",
    "inspect_room_shopping_plan",
  ]);
  expect(discovered.registrationCount).toBe(6);
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
  await page.getByRole("button", { name: "Close warnings and activity" }).click();

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
  expect(registrationCountAfterEdits).toBe(6);
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
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await installModelContextHarness(page);
  await page.clock.install({ time: new Date("2026-09-02T12:05:00.000Z") });
  await page.goto("/");

  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 6 tools registered",
  );
  await page.getByRole("button", { name: "Sign in (optional)" }).click();
  await page.getByRole("button", { name: "Continue locally" }).click();
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 11 tools registered",
  );

  await page.getByLabel("Import project-authored catalog package").setInputFiles({
    name: "cart-fixture.wimy-catalog",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(projectAuthoredCartPackage)),
  });
  await expect(page.getByRole("status", { name: "Catalog import result" })).toContainText(
    "Imported 1 project-authored catalog item: Aurora Browser Chair",
  );

  const initialRoom = (await callTool(page, "inspect_room", {})) as { revision: number };
  const initialCart = (await callTool(page, "inspect_cart", {})) as {
    ok: boolean;
    cart: { revision: number; lines: unknown[] };
  };
  expect(initialRoom.revision).toBe(1);
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
    quantity: 1,
  })) as { ok: boolean; cart: { revision: number; lines: Array<{ lineId: string }> } };
  await page.getByRole("button", { name: "Review cart" }).click();
  const cartDialog = page.getByRole("dialog", { name: "Cart review" });
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
        retailer: "Northstar Furnishings",
      },
    },
  });
  await expect(cartDialog).toContainText("Aurora Browser Chair");
  await expect(cartDialog).toContainText("Revision 2");
  await expect(cartDialog).toContainText(
    "Latest mutation: webmcp · add · accepted · Revision 2 · Aurora Browser Chair · Northstar Furnishings",
  );
  await expect(cartDialog.getByRole("button", { name: "Review sandbox checkout" })).toBeVisible();
  expect(await page.evaluate(() => Object.keys((window as typeof window & { __wimyModelContextHarness: ModelContextHarness }).__wimyModelContextHarness.tools))).not.toContain("confirm_checkout");
  await cartDialog.getByRole("button", { name: "Review sandbox checkout" }).click();
  await expect(cartDialog).toContainText("Retailer: Northstar Furnishings");
  await expect(cartDialog).toContainText("shipping and tax are unknown");
  await expect(cartDialog.getByRole("button", { name: "Confirm sandbox checkout handoff" })).toBeEnabled();
  await cartDialog.getByRole("button", { name: "Confirm sandbox checkout handoff" }).click();
  await expect(cartDialog).toContainText("Sandbox checkout handoff ready");
  await expect(cartDialog).toContainText("no order or payment was created");
  await expect(cartDialog).toContainText("Latest checkout receipt: confirm · accepted");
  await cartDialog.getByRole("button", { name: "Open sandbox checkout (inert)" }).click();
  await expect(cartDialog).toContainText("Latest checkout receipt: open · accepted");
  await cartDialog.getByRole("button", { name: "Return to Wimy" }).click();
  await expect(cartDialog).toContainText("Returned to Wimy through the local synthetic return path.");
  await expect(page).toHaveURL(/\?checkout=return&session=checkout-/u);
  expect(await page.locator("body").innerText()).not.toMatch(/order placed|payment completed|purchase successful/iu);
  expect((await callTool(page, "inspect_room", {}))).toMatchObject({ revision: 1 });

  const lineId = added.cart.lines[0]!.lineId;
  await expect(
    callTool(page, "set_cart_quantity", {
      expectedRevision: 2,
      idempotencyKey: "browser-set-aurora",
      lineId,
      quantity: 2,
    }),
  ).resolves.toMatchObject({
    ok: true,
    cart: { revision: 3, lines: [{ quantity: 2 }] },
    receipt: {
      origin: "webmcp",
      operation: "change_quantity",
      status: "accepted",
      revision: 3,
      target: {
        displayName: "Aurora Browser Chair",
        retailer: "Northstar Furnishings",
      },
    },
  });
  await expect(cartDialog).toContainText("Revision 3");
  await expect(cartDialog).toContainText(
    "Latest mutation: webmcp · change_quantity · accepted · Revision 3 · Aurora Browser Chair · Northstar Furnishings",
  );

  await expect(
    callTool(page, "remove_from_cart", {
      expectedRevision: 3,
      idempotencyKey: "browser-remove-aurora",
      lineId,
    }),
  ).resolves.toMatchObject({
    ok: true,
    cart: { revision: 4, lines: [] },
    receipt: {
      origin: "webmcp",
      operation: "remove",
      status: "accepted",
      revision: 4,
      target: {
        displayName: "Aurora Browser Chair",
        retailer: "Northstar Furnishings",
      },
    },
  });
  await expect(cartDialog).toContainText("No retailer cart lines yet.");
  await expect(cartDialog).toContainText(
    "Latest mutation: webmcp · remove · accepted · Revision 4 · Aurora Browser Chair · Northstar Furnishings",
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 6 tools registered",
  );
  await expect.poll(async () =>
    page.evaluate(() => Object.keys(window.__wimyModelContextHarness.tools).sort()),
  ).toEqual([
    "apply_room_edit",
    "find_furniture",
    "find_substitutes",
    "inspect_retailer_offers",
    "inspect_room",
    "inspect_room_shopping_plan",
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
    "WebMCP ready — 6 tools registered",
  );
  await page.getByRole("button", { name: "Sign in (optional)" }).click();
  await page.getByRole("button", { name: "Continue locally" }).click();
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 11 tools registered",
  );

  await page.clock.runFor("30:01");
  await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
    "WebMCP ready — 6 tools registered",
  );
  await expect(page.getByRole("region", { name: "Customer session" })).toContainText(
    "Anonymous mode",
  );
  await expect.poll(async () =>
    page.evaluate(() => Object.keys(window.__wimyModelContextHarness.tools).sort()),
  ).toEqual([
    "apply_room_edit",
    "find_furniture",
    "find_substitutes",
    "inspect_retailer_offers",
    "inspect_room",
    "inspect_room_shopping_plan",
  ]);
});
