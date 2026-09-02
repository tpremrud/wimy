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

test("inspect, find, and apply visibly collaborate while stale edits recover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 720 });
  await installModelContextHarness(page);
  await page.goto("/");

  await expect(
    page.getByRole("status", { name: "WebMCP status" }),
  ).toContainText(
    "WebMCP ready — 3 tools registered",
  );
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
    "inspect_room",
  ]);
  expect(discovered.registrationCount).toBe(3);
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
    .toContainText("Ember Nest Chair — x 0.3 m, y 0.3 m, rotation 0°");
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
    .toContainText("Ember Nest Chair — x 0.3 m, y 0.3 m, rotation 90°");
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
  ).toContainText("x 2.2 m, y 0.6 m, rotation 0°");
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

  const registrationCountAfterEdits = await page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __wimyModelContextHarness: ModelContextHarness;
      }
    ).__wimyModelContextHarness;
    return harness.registrationCalls.length;
  });
  expect(registrationCountAfterEdits).toBe(3);
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
    .toContainText("rotation 180°");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Human: Accepted. Applied 1 room operationsRevision 2");
});
