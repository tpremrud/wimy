import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const revisionText = (page: Page, roomName: string) =>
  page
    .getByRole("region", { name: roomName })
    .getByText(/^Revision \d+$/u);

const exportRoom = async (page: Page) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .wimy" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("expected a local Wimy download path");
  return {
    filename: download.suggestedFilename(),
    text: await readFile(path, "utf8"),
  };
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

for (const viewport of [
  { width: 1_280, height: 900 },
  { width: 1_024, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`downloads, restores maximum tokens without overflow, and undoes at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
  const externalRequests: string[] = [];
  const popups: Page[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173")) {
      externalRequests.push(request.url());
    }
  });
  page.on("popup", (popup) => popups.push(popup));
  await page.goto("/");

    const portableBox = await page
    .getByRole("region", { name: "Room files and templates" })
    .boundingBox();
  const workspaceBox = await page
    .getByRole("complementary", { name: "Furniture catalog" })
    .boundingBox();
  expect(portableBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
    expect(
      (portableBox?.y ?? Infinity) + (portableBox?.height ?? 0),
    ).toBeLessThanOrEqual(workspaceBox?.y ?? 0);

  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", { name: "Load room template" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Import .wimy file")).toBeFocused();
  await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Export .wimy" }),
    ).toBeFocused();

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

  await page.getByLabel("Import .wimy file").setInputFiles({
    name: maximumRoom.filename,
    mimeType: "application/json",
    buffer: Buffer.from(maximumRoom.text),
  });

  await expect(revisionText(page, maximumRoom.roomName)).toHaveText(
    "Revision 2",
  );
  const exportedMaximumRoom = await exportRoom(page);
  expect(exportedMaximumRoom.text).toBe(maximumRoom.text);

  await page
    .getByRole("combobox", { name: "Load room template" })
    .selectOption("blank-room");

  await expect(revisionText(page, "Blank Room")).toHaveText("Revision 3");
  await expect(page.getByLabel("Selected item actions")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Catalog results" }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue(
    "chair",
  );
  await expect(page.getByRole("combobox", { name: "Load room template" }))
    .toHaveValue("");

  await page.getByLabel("Import .wimy file").setInputFiles({
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

  await page.getByRole("button", { name: "Undo last room change" }).click();

  await expect(revisionText(page, "Blank Room")).toHaveText("Revision 5");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
    ).toContainText(
      "Undo: Accepted. Replaced the room with Blank RoomRevision 5",
    );
  await expect(
    page.getByRole("button", { name: "Undo last room change" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width);
  expect(
    await page
      .getByLabel("Import .wimy file")
      .evaluate((element) => getComputedStyle(element).maxWidth),
  ).toBe("100%");
  expect(externalRequests).toEqual([]);
  expect(popups).toEqual([]);
  });
}

test("fails closed on malformed and stale imports and never opens snapshot URLs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_024, height: 900 });
  const externalRequests: string[] = [];
  const popups: Page[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173")) {
      externalRequests.push(request.url());
    }
  });
  page.on("popup", (popup) => popups.push(popup));
  await page.goto("/");
  const input = page.getByLabel("Import .wimy file");

  await input.setInputFiles({
    name: "malformed.wimy",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });

  await expect(page.getByRole("alert")).toContainText(
    "The Wimy file is not valid JSON",
  );
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 1");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem"),
  ).toHaveCount(0);
  await expect(input).toHaveValue("");

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

  await input.setInputFiles({
    name: "networkless.wimy",
    mimeType: "text/plain",
    buffer: Buffer.from(portableText),
  });

  await expect(revisionText(page, "Living Room")).toHaveText("Revision 2");
  await expect(
    page.getByText("Catalog unavailable; using embedded snapshot."),
  ).toBeVisible();
  const portableItem = page.getByRole("button", {
    name: "Select Networkless Portable Sofa",
  });
  await portableItem.click();
  await page.getByRole("button", { name: "Rotate 90 degrees" }).click();
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 3");
  await expect(
    page.getByText("Catalog unavailable; using embedded snapshot."),
  ).toBeVisible();

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
  await input.setInputFiles({
    name: "stale.wimy",
    mimeType: "application/json",
    buffer: Buffer.from(exported.text),
  });
  await page.waitForFunction(
    () =>
      (window as typeof window & { __wimyStaleReadStarted?: boolean })
        .__wimyStaleReadStarted === true,
  );
  await portableItem.click();
  await page.getByRole("button", { name: "Rotate 90 degrees" }).click();
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 4");
  await page.evaluate(() => {
    (
      window as typeof window & { __releaseWimyImport?: () => void }
    ).__releaseWimyImport?.();
  });

  await expect(page.getByRole("alert")).toContainText(
    "Expected revision 3, but the room is at revision 4",
  );
  await expect(revisionText(page, "Living Room")).toHaveText("Revision 4");
  await expect(
    page
      .getByRole("region", { name: "Activity receipts" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Import: Rejected. Expected revision 3");
  expect(externalRequests).toEqual([]);
  expect(popups).toEqual([]);
});
