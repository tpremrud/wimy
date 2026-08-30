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

test("inspect and apply visibly mutate the room while stale edits fail", async ({
  page,
}) => {
  await installModelContextHarness(page);
  await page.goto("/");

  await expect(page.getByRole("status")).toContainText(
    "WebMCP ready — 2 tools registered",
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
    "inspect_room",
  ]);
  expect(discovered.registrationCount).toBe(2);

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
          pose: { x: 2.4, y: 0.55, rotationDeg: 0 },
        }),
      ]),
    },
    warningCount: 0,
    warningsTruncated: false,
  });

  const applied = await callTool(page, "apply_room_edit", {
    expectedRevision: 1,
    operations: [
      {
        type: "transform",
        itemId: "item_living_sofa",
        pose: { x: 2.2, y: 0.6, rotationDeg: 0 },
      },
    ],
  });
  expect(applied).toEqual({
    ok: true,
    revision: 2,
    applied: 1,
    itemIds: ["item_living_sofa"],
    warnings: [],
    warningCount: 0,
    warningsTruncated: false,
  });
  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 2");
  await expect(
    page
      .getByRole("list", { name: "Placed items" })
      .getByRole("listitem")
      .filter({ hasText: "Linen Apartment Sofa" }),
  ).toContainText("x 2.2 m, y 0.6 m, rotation 0°");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("AgentAcceptedApplied 1 room operationsRevision 2");

  await page
    .getByRole("button", {
      name: "Nudge item_living_sofa right 0.1 meters",
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 3");
  await expect(
    page
      .getByRole("list", { name: "Placed items" })
      .getByRole("listitem")
      .filter({ hasText: "Linen Apartment Sofa" }),
  ).toContainText("x 2.3 m, y 0.6 m, rotation 0°");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("HumanAcceptedApplied 1 room operationsRevision 3");
  await expect(page.getByLabel("Human edit result")).toHaveText(
    "Human edit attempt 1 accepted. Applied 1 room operations. Revision 3.",
  );

  const stale = await callTool(page, "apply_room_edit", {
    expectedRevision: 2,
    operations: [
      {
        type: "transform",
        itemId: "item_living_sofa",
        pose: { x: 2, y: 0.6, rotationDeg: 0 },
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
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText(
    "AgentRejectedExpected revision 2, but the room is at revision 3Revision 3",
  );
  await expect(
    page
      .getByRole("list", { name: "Placed items" })
      .getByRole("listitem")
      .filter({ hasText: "Linen Apartment Sofa" }),
  ).toContainText("x 2.3 m, y 0.6 m, rotation 0°");

  const registrationCountAfterEdits = await page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __wimyModelContextHarness: ModelContextHarness;
      }
    ).__wimyModelContextHarness;
    return harness.registrationCalls.length;
  });
  expect(registrationCountAfterEdits).toBe(2);
});

test("the room remains functional without modelContext", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("status")).toContainText(
    "WebMCP unavailable — human room access remains available",
  );
  await expect(page.getByRole("heading", { name: "Living Room" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 1");

  await page
    .getByRole("button", {
      name: "Nudge item_living_sofa right 0.1 meters",
    })
    .click();

  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 2");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("HumanAcceptedApplied 1 room operationsRevision 2");
});
