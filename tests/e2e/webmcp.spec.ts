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
  await page.setViewportSize({ width: 1_280, height: 720 });
  await installModelContextHarness(page);
  await page.goto("/");

  await expect(
    page.getByRole("status", { name: "WebMCP status" }),
  ).toContainText(
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
    page.getByRole("button", { name: "Select Linen Apartment Sofa" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select Linen Apartment Sofa" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Selected item actions"))
    .toContainText("Linen Apartment Sofa — x 2.2 m, y 0.6 m, rotation 0°");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Agent: Accepted. Applied 1 room operationsRevision 2");

  const chair = page.getByRole("button", { name: "Select Soft Lounge Chair" });
  const dragGeometry = await chair.evaluate((element) => {
    const item = element as SVGGElement;
    const svg = item.ownerSVGElement;
    const footprint = item.querySelector<SVGRectElement>(
      ".room-item-footprint",
    );
    const boundary = svg?.querySelector<SVGRectElement>(".room-boundary");
    const matrix = svg?.getScreenCTM();
    if (!svg || !footprint || !boundary || !matrix) {
      throw new Error("expected rendered room geometry");
    }

    const roomScale = Number(boundary.getAttribute("width")) / 4.8;
    const center = {
      x:
        Number(footprint.getAttribute("x")) +
        Number(footprint.getAttribute("width")) / 2,
      y:
        Number(footprint.getAttribute("y")) +
        Number(footprint.getAttribute("height")) / 2,
    };
    const start = new DOMPoint(center.x, center.y).matrixTransform(matrix);
    const release = new DOMPoint(
      center.x + roomScale * 0.5,
      center.y + roomScale,
    ).matrixTransform(matrix);
    const bounds = svg.getBoundingClientRect();

    return {
      bounds: { width: bounds.width, height: bounds.height },
      ctm: { a: matrix.a, d: matrix.d, e: matrix.e, f: matrix.f },
      start: { x: start.x, y: start.y },
      release: { x: release.x, y: release.y },
    };
  });

  expect(dragGeometry.bounds.width).toBeGreaterThan(600);
  expect(dragGeometry.bounds.height).toBeLessThanOrEqual(461);
  expect(dragGeometry.ctm.a).toBeCloseTo(dragGeometry.ctm.d, 5);
  expect(dragGeometry.ctm.a).toBeLessThan(
    dragGeometry.bounds.width / 720,
  );
  expect(dragGeometry.ctm.e).toBeGreaterThan(0);
  await page.mouse.move(dragGeometry.start.x, dragGeometry.start.y);
  await page.mouse.down();
  await page.mouse.move(dragGeometry.release.x, dragGeometry.release.y, {
    steps: 4,
  });
  await page.mouse.up();

  await expect(
    page.getByRole("region", { name: "Living Room" }),
  ).toContainText("Revision 3");
  await expect(page.getByLabel("Selected item actions"))
    .toContainText("Soft Lounge Chair — x 1.6 m, y 3.3 m, rotation 90°");
  await expect(page.getByLabel("Selected item actions")).not.toContainText(
    "x 1.388 m",
  );
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
    "Agent: Rejected. Expected revision 2, but the room is at revision 3Revision 3",
  );
  await page
    .getByRole("button", { name: "Select Linen Apartment Sofa" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Selected item actions"),
  ).toContainText("x 2.2 m, y 0.6 m, rotation 0°");

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
