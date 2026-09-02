import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const revisionText = (page: Page, roomName: string) =>
  page
    .getByRole("region", { name: roomName })
    .getByText(/^Revision \d+$/u);

const openShare = async (page: Page) => {
  const dialog = page.getByRole("dialog", { name: "Share room" });
  if (await dialog.count()) return dialog;
  await page.getByRole("button", { name: "Share room", exact: true }).click();
  return dialog;
};

const closeShare = async (page: Page) => {
  const closeButton = page.getByRole("button", { name: "Close share room" });
  if (await closeButton.count()) await closeButton.click();
};

const exportRoom = async (page: Page) => {
  const share = await openShare(page);
  const downloadPromise = page.waitForEvent("download");
  await share.getByRole("button", { name: "Export .wimy" }).click();
  const download = await downloadPromise;
  await closeShare(page);
  const path = await download.path();
  if (!path) throw new Error("expected a local Wimy download path");
  return {
    filename: download.suggestedFilename(),
    text: await readFile(path, "utf8"),
  };
};

const importFile = async (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) => {
  const share = await openShare(page);
  await share.getByLabel("Import .wimy file").setInputFiles(file);
  return share;
};

const selectTemplate = async (page: Page, template: string) => {
  const share = await openShare(page);
  await share.getByRole("combobox", { name: "Load room template" }).selectOption(template);
};

type PortableRoomFile = Record<string, unknown> & {
  room: {
    name: string;
    openings: Array<{ id: string }>;
    items: Array<{
      id: string;
      pose: { x: number; y: number; rotationDeg: number };
      snapshot: { name: string };
    }>;
  };
};

const maximumToken = (prefix: string, length: number) =>
  `${prefix}${"x".repeat(length - prefix.length)}`;

const getLocalOrigin = (baseURL: unknown) => {
  if (typeof baseURL !== "string" || !URL.canParse(baseURL)) {
    throw new Error("expected a valid Playwright project baseURL");
  }
  return new URL(baseURL).origin;
};

const createMaximumTokenRoom = (source: string) => {
  const envelope = JSON.parse(source) as PortableRoomFile;
  envelope.room.name = maximumToken("R", 80);
  envelope.room.openings = envelope.room.openings.map((opening, index) => ({
    ...opening,
    id: maximumToken(`O${index}`, 64),
  }));
  envelope.room.items = envelope.room.items.map((item, index) => ({
    ...item,
    id: maximumToken(`I${index}`, 64),
    snapshot: {
      ...item.snapshot,
      name: maximumToken(`N${index}`, 120),
    },
  }));

  const firstItem = envelope.room.items[0];
  const overlappingItem = envelope.room.items[2];
  const doorBlockingItem = envelope.room.items[3];
  if (!firstItem || !overlappingItem || !doorBlockingItem) {
    throw new Error("expected the living room maximum-token fixture items");
  }
  overlappingItem.pose = { ...firstItem.pose };
  doorBlockingItem.pose = { x: 0.4, y: 3.45, rotationDeg: 90 };

  return {
    filename: "maximum-token-room.wimy",
    itemIds: envelope.room.items.map(({ id }) => id),
    itemNames: envelope.room.items.map(({ snapshot }) => snapshot.name),
    roomName: envelope.room.name,
    text: `${JSON.stringify(envelope, null, 2)}\n`,
  };
};

const itemIdentityAndPoses = (source: string) => {
  const envelope = JSON.parse(source) as PortableRoomFile;
  return envelope.room.items.map(({ id, pose }) => ({ id, pose }));
};

for (const viewport of [
  { width: 1_280, height: 900 },
  { width: 1_024, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`downloads, restores maximum tokens without overflow, and undoes at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const localOrigin = getLocalOrigin(testInfo.project.use.baseURL);
    const externalRequests: string[] = [];
    const popups: Page[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(localOrigin)) {
        externalRequests.push(request.url());
      }
    });
    page.on("popup", (popup) => popups.push(popup));
    await page.goto("/");

    const workspaceBefore = await page
      .getByRole("region", { name: "Living Room" })
      .boundingBox();
    const share = await openShare(page);
    await expect(share.getByRole("combobox", { name: "Load room template" })).toBeVisible();
    await expect(share.getByLabel("Import .wimy file")).toBeVisible();
    await expect(share.getByRole("button", { name: "Export .wimy" })).toBeVisible();
    const workspaceAfter = await page
      .getByRole("region", { name: "Living Room" })
      .boundingBox();
    expect(workspaceAfter).toEqual(workspaceBefore);
    await closeShare(page);

  await page
    .getByRole("button", { name: "Select Linen Apartment Sofa" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Selected item actions")).toBeVisible();
  await page.getByRole("combobox", { name: "Category" }).selectOption("chair");
  await page.getByRole("textbox", { name: "Style tags" }).fill("warm-modern");
  await page
    .getByRole("spinbutton", { name: "Maximum price (USD)" })
    .fill("600");
  await page.getByRole("button", { name: "Search catalog" }).click();
  await expect(
    page.getByRole("list", { name: "Catalog results" }),
  ).toBeVisible();
  const exported = await exportRoom(page);
  const envelope = JSON.parse(exported.text) as PortableRoomFile;
  const maximumRoom = createMaximumTokenRoom(exported.text);
  expect(exported.filename).toBe("living-room.wimy");
  expect(Object.keys(envelope)).toEqual(["format", "schemaVersion", "room"]);
  expect(exported.text).not.toContain('"revision"');
  expect(exported.text).not.toContain('"receipts"');

  await importFile(page, {
    name: maximumRoom.filename,
    mimeType: "application/json",
    buffer: Buffer.from(maximumRoom.text),
  });

  await expect(revisionText(page, maximumRoom.roomName)).toHaveText(
    "Revision 2",
  );
  const [headingBox, revisionBox, viewControlsBox] = await Promise.all([
    page.getByRole("heading", { name: maximumRoom.roomName }).boundingBox(),
    revisionText(page, maximumRoom.roomName).boundingBox(),
    page.getByRole("group", { name: "Room view" }).boundingBox(),
  ]);
  if (!headingBox || !revisionBox || !viewControlsBox) {
    throw new Error("expected imported room heading, revision, and view controls");
  }
  const intersects = (
    first: { x: number; y: number; width: number; height: number },
    second: { x: number; y: number; width: number; height: number },
  ) =>
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
  expect(intersects(headingBox, viewControlsBox)).toBe(false);
  expect(intersects(revisionBox, viewControlsBox)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  const exportedMaximumRoom = await exportRoom(page);
  expect(exportedMaximumRoom.text).toBe(maximumRoom.text);

  await selectTemplate(page, "blank-room");

  await expect(revisionText(page, "Blank Room")).toHaveText("Revision 3");
  await expect(page.getByLabel("Selected item actions")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Catalog results" }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue(
    "chair",
  );
  const blankShare = await openShare(page);
  await expect(blankShare.getByRole("combobox", { name: "Load room template" })).toHaveValue("");
  await closeShare(page);

  await importFile(page, {
    name: exportedMaximumRoom.filename,
    mimeType: "application/json",
    buffer: Buffer.from(exportedMaximumRoom.text),
  });

  await expect(revisionText(page, maximumRoom.roomName)).toHaveText(
    "Revision 4",
  );
  const restoredIds = await page
    .locator(".room-item")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-item-id")),
    );
  expect(restoredIds).toEqual(maximumRoom.itemIds);
  const canonicalReExport = await exportRoom(page);
  expect(canonicalReExport.text).toBe(exportedMaximumRoom.text);
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
    ).toContainText(
      `Import: Accepted. Replaced the room with ${maximumRoom.roomName}Revision 4`,
    );
  await page
    .getByRole("button", { name: `Select ${maximumRoom.itemNames[0]}` })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Selected item actions")).toContainText(
    maximumRoom.itemNames[0] ?? "",
  );
  await expect(page.getByLabel("Selected item actions")).toContainText(
    "Facing south",
  );
  await expect(
    page.getByText(
      `${maximumRoom.itemIds[0]} overlaps ${maximumRoom.itemIds[2]}`,
    ),
  ).toBeVisible();
  const documentWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentWidth.clientWidth).toBeLessThanOrEqual(viewport.width);
  expect(documentWidth.scrollWidth).toBeLessThanOrEqual(
    documentWidth.clientWidth,
  );

  const undoShare = await openShare(page);
  await undoShare.getByRole("button", { name: "Undo last room change" }).click();

  await expect(revisionText(page, "Blank Room")).toHaveText("Revision 5");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
    ).toContainText(
      "Undo: Accepted. Replaced the room with Blank RoomRevision 5",
    );
  const finalShare = await openShare(page);
  await expect(
    finalShare.getByRole("button", { name: "Undo last room change" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width);
  expect(
    await finalShare
      .getByLabel("Import .wimy file")
      .evaluate((element) => getComputedStyle(element).maxWidth),
  ).toBe("100%");
  await closeShare(page);
  expect(externalRequests).toEqual([]);
  expect(popups).toEqual([]);
  });
}

test("skips header controls to the room workspace", async ({ page }) => {
  await page.goto("/");

  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to room workspace" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#room-workspace")).toBeFocused();
});

test("moves a placed item with an actual pointer drag", async ({ page }) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("/");

  const before = await exportRoom(page);
  const beforeEnvelope = JSON.parse(before.text) as PortableRoomFile;
  const sofaBefore = beforeEnvelope.room.items.find(
    ({ id }) => id === "item_living_sofa",
  );
  if (!sofaBefore) throw new Error("expected the living-room sofa");

  const sofa = page.locator('[data-item-id="item_living_sofa"]');
  const sofaBox = await sofa.boundingBox();
  const roomPlanBox = await page
    .getByRole("group", { name: "Living Room 2D room editor" })
    .boundingBox();
  if (!sofaBox || !roomPlanBox) {
    throw new Error("expected a visible sofa and room plan");
  }

  const start = {
    x: sofaBox.x + sofaBox.width / 2,
    y: sofaBox.y + sofaBox.height / 2,
  };
  const delta = {
    x: Math.min(48, Math.max(16, roomPlanBox.width / 12)),
    y: Math.min(32, Math.max(12, roomPlanBox.height / 16)),
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 });
  await page.mouse.up();

  await expect(revisionText(page, "Living Room")).toHaveText("Revision 2");
  await expect(page.getByLabel("Selected item actions")).toContainText(
    "Linen Apartment Sofa",
  );
  await expect(page.getByLabel("Human edit result")).toHaveText(
    "Human edit attempt 1 accepted. Applied 1 room operations. Revision 2.",
  );
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Human: Accepted. Applied 1 room operationsRevision 2");

  const after = await exportRoom(page);
  const afterEnvelope = JSON.parse(after.text) as PortableRoomFile;
  const sofaAfter = afterEnvelope.room.items.find(
    ({ id }) => id === "item_living_sofa",
  );
  if (!sofaAfter) throw new Error("expected the moved living-room sofa");
  expect(sofaAfter.pose.rotationDeg).toBe(sofaBefore.pose.rotationDeg);
  expect(sofaAfter.pose.x !== sofaBefore.pose.x || sofaAfter.pose.y !== sofaBefore.pose.y).toBe(
    true,
  );
});

test("round-trips a searched placement through export, blank, and import", async ({
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
  await expect(page.getByRole("list", { name: "Catalog results" })).toContainText(
    "Ember Nest Chair",
  );

  await page.getByRole("button", { name: "Add best fit" }).click();
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 2");
  const exported = await exportRoom(page);
  const expectedItems = itemIdentityAndPoses(exported.text);
  expect(expectedItems).toHaveLength(6);
  expect(expectedItems.some(({ id }) => id.startsWith("item_"))).toBe(true);

  await selectTemplate(page, "blank-room");
  await expect(revisionText(page, "Blank Room")).toHaveText("Revision 3");
  await expect(page.locator(".room-item")).toHaveCount(0);

  await importFile(page, {
    name: exported.filename,
    mimeType: "application/json",
    buffer: Buffer.from(exported.text),
  });
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 4");

  const restored = await exportRoom(page);
  const restoredItems = itemIdentityAndPoses(restored.text);
  expect(restoredItems.map(({ id }) => id)).toEqual(
    expectedItems.map(({ id }) => id),
  );
  expect(restoredItems.map(({ pose }) => pose)).toEqual(
    expectedItems.map(({ pose }) => pose),
  );
  expect(restored.text).toBe(exported.text);

  const editorItemCount = await page.locator(".room-item").count();
  expect(editorItemCount).toBe(expectedItems.length);
  await page.getByRole("button", { name: "Preview in 3D" }).click();
  const preview = page.getByRole("region", {
    name: "3D preview of Living Room",
  });
  await expect(preview).toBeVisible();
  const previewItems = preview
    .getByRole("list", { name: "Placed items in Living Room" })
    .getByRole("listitem");
  await expect(previewItems).toHaveCount(editorItemCount);
  await expect(preview).toContainText("Ember Nest Chair");
});

test("fails closed on malformed and stale imports and never opens snapshot URLs", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_024, height: 900 });
  const localOrigin = getLocalOrigin(testInfo.project.use.baseURL);
  const externalRequests: string[] = [];
  const popups: Page[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(localOrigin)) {
      externalRequests.push(request.url());
    }
  });
  page.on("popup", (popup) => popups.push(popup));
  await page.goto("/");
  await importFile(page, {
    name: "malformed.wimy",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });

  await expect(page.getByRole("alert")).toContainText(
    "The Wimy file is not valid JSON",
  );
  await closeShare(page);
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 1");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem"),
  ).toHaveCount(0);
  const malformedCheck = await openShare(page);
  await expect(malformedCheck.getByLabel("Import .wimy file")).toHaveValue("");
  await closeShare(page);

  const exported = await exportRoom(page);
  const portable = JSON.parse(exported.text) as {
    room: {
      items: Array<{
        catalogRef?: { catalogId: string; productId: string };
        snapshot: {
          name: string;
          commerce?: {
            price: { amount: number; currency: string };
            productUrl?: string;
          };
        };
      }>;
    };
  };
  const portableItemSnapshot = portable.room.items.find(
    (item) =>
      (item as typeof item & { id?: string }).id === "item_living_chair",
  );
  if (!portableItemSnapshot) throw new Error("expected the living-room chair");
  portableItemSnapshot.catalogRef = {
    catalogId: "portable-archive",
    productId: "retired-network-sofa",
  };
  portableItemSnapshot.snapshot.name = "Networkless Portable Sofa";
  portableItemSnapshot.snapshot.commerce = {
    price: { amount: 399, currency: "USD" },
    productUrl: "https://example.invalid/must-not-open",
  };
  const portableText = `${JSON.stringify(portable, null, 2)}\n`;

  await importFile(page, {
    name: "networkless.wimy",
    mimeType: "text/plain",
    buffer: Buffer.from(portableText),
  });

  await expect(revisionText(page, "Living Room")).toHaveText("Revision 2");
  await expect(
    page.getByText("Catalog unavailable; using embedded snapshot."),
  ).toBeVisible();
  await closeShare(page);
  const portableItem = page.getByRole("button", {
    name: "Select Networkless Portable Sofa",
  });
  await portableItem.click();
  await page.getByRole("button", { name: "Rotate 90 degrees" }).click();
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 3");
  await expect(
    page.getByText("Catalog unavailable; using embedded snapshot."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close warnings and activity" }).click();

  await page.evaluate(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, {
      __releaseWimyImport: release,
      __wimyStaleReadStarted: false,
    });
    File.prototype.arrayBuffer = async function delayedArrayBuffer() {
      if (this.name === "stale.wimy") {
        Object.assign(window, { __wimyStaleReadStarted: true });
        await gate;
      }
      return originalArrayBuffer.call(this);
    };
  });
  await importFile(page, {
    name: "stale.wimy",
    mimeType: "application/json",
    buffer: Buffer.from(exported.text),
  });
  await page.waitForFunction(
    () =>
      (window as typeof window & { __wimyStaleReadStarted?: boolean })
        .__wimyStaleReadStarted === true,
  );
  await closeShare(page);
  await portableItem.click();
  await page.getByRole("button", { name: "Rotate 90 degrees" }).click();
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 4");
  await page.evaluate(() => {
    (
      window as typeof window & { __releaseWimyImport?: () => void }
    ).__releaseWimyImport?.();
  });

  await expect(revisionText(page, "Living Room")).toHaveText("Revision 4");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Import: Rejected. Expected revision 3");
  const staleShare = await openShare(page);
  await expect(staleShare.getByRole("alert")).toContainText(
    "Expected revision 3, but the room is at revision 4",
  );
  await closeShare(page);
  expect(externalRequests).toEqual([]);
  expect(popups).toEqual([]);
});

test("keeps the read-only 3D preview synchronized through template and import changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  await page.getByRole("button", { name: "Select Soft Lounge Chair" }).click();
  await page.getByRole("button", { name: "Rotate 90 degrees" }).click();
  const livingRoomExport = await exportRoom(page);

  await page.getByRole("button", { name: "Preview in 3D" }).click();
  const canvas = page.locator(".room-preview-canvas canvas");
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("region", { name: "3D preview of Living Room" }),
  ).toContainText("Soft Lounge Chair — x 1.1 m, y 2.3 m, rotation 180°");

  await selectTemplate(page, "compact-bedroom");
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("region", { name: "3D preview of Compact Bedroom" }),
  ).toContainText("Platform Bed");

  await importFile(page, {
    name: livingRoomExport.filename,
    mimeType: "application/json",
    buffer: Buffer.from(livingRoomExport.text),
  });
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("region", { name: "3D preview of Living Room" }),
  ).toContainText("Soft Lounge Chair — x 1.1 m, y 2.3 m, rotation 180°");

  await page.getByRole("button", { name: "Edit in 2D" }).click();
  await expect(
    page.getByRole("group", { name: "Living Room 2D room editor" }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("reframes the actual 3D camera after importing materially larger room dimensions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Preview in 3D" }).click();
  const canvas = page.locator(".room-preview-canvas canvas");
  await expect(canvas).toBeVisible();

  await importFile(page, {
    name: "huge-room.wimy",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "wimy-room",
        schemaVersion: 1,
        room: {
          name: "Huge Room",
          dimensions: { width: 30, depth: 30, height: 10 },
          openings: [],
          items: [],
        },
      }),
    ),
  });
  await expect(
    page.getByRole("region", { name: "3D preview of Huge Room" }),
  ).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-wimy-camera-position", /,/u);
  const camera = await canvas.evaluate((element) => ({
    aspect: element.clientWidth / element.clientHeight,
    far: Number(element.dataset.wimyCameraFar),
    position: element.dataset.wimyCameraPosition?.split(",").map(Number),
  }));
  const radius = Math.hypot(30, 10, 30) / 2;
  const verticalHalfAngle = (42 * Math.PI) / 360;
  const horizontalHalfAngle = Math.atan(
    Math.tan(verticalHalfAngle) * camera.aspect,
  );
  const distance =
    (radius / Math.sin(Math.min(verticalHalfAngle, horizontalHalfAngle))) *
    1.18;
  const directionLength = Math.hypot(1, 0.8, 1);
  const expectedPosition = [
    15 + distance / directionLength,
    5 + (distance * 0.8) / directionLength,
    15 + distance / directionLength,
  ];

  expect(camera.position).toHaveLength(3);
  camera.position?.forEach((value, index) =>
    expect(value).toBeCloseTo(expectedPosition[index] ?? 0, 1),
  );
  expect(camera.far).toBeCloseTo(distance + radius * 2, 1);
});

test("accepts real user orbit input while the 3D preview remains visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Preview in 3D" }).click();
  const canvas = page.locator(".room-preview-canvas canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-wimy-camera-position", /.+/u);
  const initialPosition = await canvas.getAttribute("data-wimy-camera-position");
  if (!initialPosition) throw new Error("expected an initial 3D camera position");

  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("expected a visible 3D canvas");
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.7, canvasBox.y + canvasBox.height * 0.42, { steps: 8 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute(
    "data-wimy-camera-position",
    initialPosition,
  );
  await expect(canvas).toHaveAttribute("data-wimy-camera-position", /.+/u);
  const userOrbitPosition = await canvas.getAttribute(
    "data-wimy-camera-position",
  );
  if (!userOrbitPosition) throw new Error("expected a user-orbited camera position");
  expect(userOrbitPosition.split(",").map(Number)).toHaveLength(3);
  expect(userOrbitPosition).not.toBe(initialPosition);
  await expect(
    page.getByRole("region", { name: "3D preview of Living Room" }),
  ).toContainText("Linen Apartment Sofa");
});

for (const viewport of [
  { width: 1_280, height: 900 },
  { width: 1_024, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`does not overflow at ${viewport.width}px in the 3D preview`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Preview in 3D" }).click();
    await expect(page.locator(".room-preview-canvas canvas")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}
