import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCatalogProduct } from "../room/catalog";
import { WimyRoomV1Schema } from "../room/document";
import { createRoomStore } from "../room/store";
import { getTemplate } from "../room/templates";
import { serializeWimyRoom } from "../room/wimy-file";
import { makeOpening, makePlacedItem, makeRoom } from "../test/room-fixtures";
import {
  FileAndTemplateControls,
  RoomWarnings,
} from "./FileAndTemplateControls";

const createTestStore = () =>
  createRoomStore(getTemplate("living-room"), {
    resolveProduct: resolveCatalogProduct,
    createItemId: () => "item_test_import_1",
  });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });

const createDelayedFile = (text: string, name = "delayed.wimy") => {
  const bytes = new TextEncoder().encode(text);
  let resolve!: (value: ArrayBuffer) => void;
  const buffer = new Promise<ArrayBuffer>((resolvePromise) => {
    resolve = resolvePromise;
  });
  let reads = 0;
  const file = new File([bytes], name, { type: "application/json" });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => {
      reads += 1;
      return buffer;
    },
  });

  return {
    file,
    get reads() {
      return reads;
    },
    resolve: () => resolve(bytes.buffer.slice(0) as ArrayBuffer),
  };
};

const createMaximumWarningRoom = () =>
  WimyRoomV1Schema.parse({
    name: "Maximum warnings",
    dimensions: { width: 30, depth: 30, height: 10 },
    openings: Array.from({ length: 20 }, (_, index) => ({
      id: `door_${index}`,
      kind: "door" as const,
      wall: "north" as const,
      centerOffset: 0.5 + index * 1.5,
      width: 1,
      bottom: 0,
      height: 2.1,
    })),
    items: Array.from({ length: 100 }, (_, index) => ({
      id: `item_${index}`,
      catalogRef: { catalogId: "archive", productId: `product_${index}` },
      pose: { x: 15, y: 0.5, rotationDeg: 0 as const },
      snapshot: {
        name: `Chair ${index}`,
        category: "chair" as const,
        dimensions: { width: 0.1, depth: 0.1, height: 0.1 },
        appearance: { color: "#ffffff" },
        styleTags: [],
      },
    })),
  });

describe("FileAndTemplateControls", () => {
  it("keeps the current room after invalid import", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const before = store.getState();
    render(
      <>
        <FileAndTemplateControls store={store} />
        <RoomWarnings store={store} />
      </>,
    );

    const file = new File(
      ['{"format":"wimy-room","schemaVersion":9}'],
      "bad.wimy",
    );
    await user.upload(screen.getByLabelText("Import .wimy file"), file);

    await waitFor(() =>
      expect(
        screen.getByRole("alert", { name: "Room file alert" }),
      ).toHaveTextContent(
        "UNSUPPORTED_SCHEMA_VERSION: Expected Wimy schema version 1",
      ),
    );
    expect(store.getState().room).toBe(before.room);
    expect(store.getState().revision).toBe(before.revision);
    expect(store.getState().receipts).toHaveLength(0);
  });

  it("keeps invalid-document diagnostics bounded without echoing imported keys", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const unsafeKey = `<img src=x onerror=alert(1)>${"x".repeat(2_048)}`;
    const room = getTemplate("blank-room");
    const invalidRoom = {
      ...room,
      dimensions: {
        ...room.dimensions,
        [unsafeKey]: "private imported content",
      },
    };
    render(<FileAndTemplateControls store={store} />);

    await user.upload(
      screen.getByLabelText("Import .wimy file"),
      new File(
        [
          JSON.stringify({
            format: "wimy-room",
            schemaVersion: 1,
            room: invalidRoom,
          }),
        ],
        "unsafe-key.wimy",
      ),
    );

    const alert = await screen.findByRole("alert", {
      name: "Room file alert",
    });
    expect(alert).toHaveTextContent(
      "INVALID_DOCUMENT at room.dimensions: Invalid Wimy document: Unexpected field",
    );
    expect(alert).not.toHaveTextContent(unsafeKey);
    expect(alert).not.toHaveTextContent("private imported content");
    expect(alert).not.toHaveTextContent("<img");
    expect(alert.textContent?.length).toBeLessThanOrEqual(200);
    expect(store.getState()).toMatchObject({ revision: 1, receipts: [] });
  });

  it("imports one portable replacement with stable IDs and current catalog warnings", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().selectItem("item_living_sofa");
    const imported = getTemplate("compact-bedroom");
    const firstItem = imported.items[0];
    if (!firstItem) throw new Error("expected a compact-bedroom item");
    firstItem.catalogRef = {
      catalogId: "portable-archive",
      productId: "retired-bed",
    };
    const importedIds = imported.items.map(({ id }) => id);
    render(
      <>
        <FileAndTemplateControls store={store} />
        <RoomWarnings store={store} />
      </>,
    );

    await user.upload(
      screen.getByLabelText("Import .wimy file"),
      new File([serializeWimyRoom(imported)], "portable-room.txt", {
        type: "text/plain",
      }),
    );

    expect(store.getState().revision).toBe(2);
    expect(store.getState().room.items.map(({ id }) => id)).toEqual(
      importedIds,
    );
    expect(store.getState().selectedItemId).toBeNull();
    expect(store.getState().receipts).toMatchObject([
      { origin: "import", status: "accepted", revision: 2 },
    ]);
    expect(store.getState().createUndoRequest()).not.toBeNull();
    expect(
      await screen.findByText(
        "Catalog unavailable; using embedded snapshot.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Portable room action status" }),
    ).toHaveTextContent(
      "Current room has 2 room warnings. Review the Room warnings region.",
    );
  });

  it("preflights 1,000,001 bytes but lets exactly 1,000,000 bytes reach the codec", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<FileAndTemplateControls store={store} />);
    const input = screen.getByLabelText("Import .wimy file");
    const importedText = serializeWimyRoom(getTemplate("blank-room"));
    let oversizedReads = 0;
    const oversized = new File(["x".repeat(1_000_001)], "oversized.bin");
    Object.defineProperty(oversized, "arrayBuffer", {
      value: async () => {
        oversizedReads += 1;
        return new ArrayBuffer(0);
      },
    });

    await user.upload(input, oversized);

    expect(oversized.size).toBe(1_000_001);
    expect(oversizedReads).toBe(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Import attempt 1 rejected. FILE_TOO_LARGE:",
    );
    expect(store.getState().revision).toBe(1);

    const accepted = new File(
      [importedText, " ".repeat(1_000_000 - importedText.length)],
      "exactly-one-million.anything",
      { type: "application/octet-stream" },
    );
    await user.upload(input, accepted);

    expect(accepted.size).toBe(1_000_000);
    expect(store.getState().revision).toBe(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Import attempt 2 accepted",
    );
  });

  it("uses a resettable template action picker for one replacement per activation", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<FileAndTemplateControls store={store} />);
    const picker = screen.getByRole("combobox", {
      name: "Load room template",
    });

    expect(picker).toHaveValue("");
    expect(store.getState()).toMatchObject({ revision: 1, receipts: [] });

    await user.selectOptions(picker, "blank-room");

    expect(store.getState().room.name).toBe("Blank Room");
    expect(store.getState().revision).toBe(2);
    expect(store.getState().receipts).toMatchObject([
      { origin: "template", status: "accepted", revision: 2 },
    ]);
    expect(
      screen.getByRole("status", { name: "Portable room action status" }),
    ).toHaveTextContent("Current room has 0 room warnings.");
    expect(picker).toHaveValue("");

    await user.selectOptions(picker, "blank-room");

    expect(store.getState().revision).toBe(3);
    expect(store.getState().receipts).toMatchObject([
      { origin: "template", status: "accepted", revision: 3 },
      { origin: "template", status: "accepted", revision: 2 },
    ]);
    expect(picker).toHaveValue("");
  });

  it("downloads only the latest canonical room with a sanitized single suffix", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const latest = getTemplate("compact-bedroom");
    latest.name = "../Latest Room.wimy.WIMY";
    store.getState().transact({
      expectedRevision: 1,
      origin: "template",
      change: { type: "replace", room: latest },
    });
    store.getState().selectItem(latest.items[0]?.id ?? null);
    const before = store.getState();
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return "blob:wimy-export";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let clickedAnchor: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      clickedAnchor = document.querySelector("a[download]") ?? undefined;
    });
    render(<FileAndTemplateControls store={store} />);

    await user.click(screen.getByRole("button", { name: "Export .wimy" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob | undefined;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("application/json");
    expect(blob && (await readBlobText(blob))).toBe(
      serializeWimyRoom(latest),
    );
    expect(clickedAnchor?.download).toBe("latest-room.wimy");
    expect(clickedAnchor?.href).toBe("blob:wimy-export");
    expect(clickedAnchor?.isConnected).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:wimy-export");
    expect(store.getState()).toMatchObject({
      room: before.room,
      revision: before.revision,
      receipts: before.receipts,
      previousRoom: before.previousRoom,
      selectedItemId: before.selectedItemId,
    });
  });

  it("revokes the export URL and removes its anchor when clicking throws", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return "blob:failed-export";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let clickedAnchor: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      clickedAnchor = document.querySelector("a[download]") ?? undefined;
      throw new Error("download click failed");
    });
    render(<FileAndTemplateControls store={store} />);

    await user.click(screen.getByRole("button", { name: "Export .wimy" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Export attempt 1 rejected. download click failed",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:failed-export");
    expect(clickedAnchor?.isConnected).toBe(false);
    expect(store.getState()).toMatchObject({ revision: 1, receipts: [] });
  });

  it("submits a fresh one-step undo request through the transaction seam", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<FileAndTemplateControls store={store} />);
    const undo = screen.getByRole("button", {
      name: "Undo last room change",
    });

    expect(undo).toBeDisabled();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Load room template" }),
      "blank-room",
    );
    expect(undo).toBeEnabled();

    await user.click(undo);

    expect(store.getState().room.name).toBe("Living Room");
    expect(store.getState().revision).toBe(3);
    expect(store.getState().receipts).toMatchObject([
      { origin: "undo", status: "accepted", revision: 3 },
      { origin: "template", status: "accepted", revision: 2 },
    ]);
    expect(store.getState().createUndoRequest()).toBeNull();
    expect(undo).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Load room template" }),
    ).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Undo attempt 1 accepted",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Current room has 0 room warnings.",
    );
  });

  it("rejects a delayed stale import once and lets the same file be retried", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const imported = getTemplate("compact-bedroom");
    const delayed = createDelayedFile(serializeWimyRoom(imported));
    render(<FileAndTemplateControls store={store} />);
    const input = screen.getByLabelText("Import .wimy file");

    await user.upload(input, delayed.file);
    await waitFor(() => expect(delayed.reads).toBe(1));
    const humanResult = store.getState().transact({
      expectedRevision: 1,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2 },
          },
        ],
      },
    });
    const undoBeforeImport = store.getState().createUndoRequest();

    await act(async () => delayed.resolve());

    await waitFor(() =>
      expect(
        screen.getByRole("alert", { name: "Room file alert" }),
      ).toHaveTextContent(
        "Expected revision 1, but the room is at revision 2",
      ),
    );
    expect(store.getState().revision).toBe(2);
    expect(store.getState().room.name).toBe("Living Room");
    expect(store.getState().receipts).toMatchObject([
      { origin: "import", status: "rejected", code: "REVISION_CONFLICT" },
      humanResult.receipt,
    ]);
    expect(store.getState().receipts).toHaveLength(2);
    expect(store.getState().createUndoRequest()).toEqual(undoBeforeImport);
    expect(input).toHaveValue("");

    await user.upload(input, delayed.file);

    expect(store.getState().revision).toBe(3);
    expect(store.getState().room).toEqual(imported);
    expect(delayed.reads).toBe(2);
  });

  it("prevents superseded and replacement-store imports from mutating hidden owners", async () => {
    const user = userEvent.setup();
    const firstStore = createTestStore();
    const secondStore = createRoomStore(
      getTemplate("compact-bedroom"),
      {
        resolveProduct: resolveCatalogProduct,
        createItemId: () => "item_second_store",
      },
    );
    const firstDelayed = createDelayedFile(
      serializeWimyRoom(getTemplate("compact-bedroom")),
      "first.wimy",
    );
    const hiddenDelayed = createDelayedFile(
      serializeWimyRoom(getTemplate("blank-room")),
      "hidden.wimy",
    );
    const view = render(<FileAndTemplateControls store={firstStore} />);
    const input = screen.getByLabelText("Import .wimy file");

    await user.upload(input, firstDelayed.file);
    await waitFor(() => expect(firstDelayed.reads).toBe(1));
    await user.upload(
      input,
      new File(
        [serializeWimyRoom(getTemplate("blank-room"))],
        "winner.wimy",
      ),
    );
    await act(async () => firstDelayed.resolve());

    expect(firstStore.getState()).toMatchObject({
      revision: 2,
      room: { name: "Blank Room" },
    });
    expect(firstStore.getState().receipts).toMatchObject([
      { origin: "import", status: "accepted" },
    ]);

    await user.upload(input, hiddenDelayed.file);
    await waitFor(() => expect(hiddenDelayed.reads).toBe(1));
    view.rerender(<FileAndTemplateControls store={secondStore} />);
    await act(async () => hiddenDelayed.resolve());

    expect(firstStore.getState().revision).toBe(2);
    expect(secondStore.getState()).toMatchObject({
      revision: 1,
      room: { name: "Compact Bedroom" },
      receipts: [],
    });
  });

  it("invalidates a delayed import when the controls unmount", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const delayed = createDelayedFile(
      serializeWimyRoom(getTemplate("blank-room")),
      "unmounted.wimy",
    );
    const view = render(<FileAndTemplateControls store={store} />);

    await user.upload(
      screen.getByLabelText("Import .wimy file"),
      delayed.file,
    );
    await waitFor(() => expect(delayed.reads).toBe(1));
    view.unmount();
    await act(async () => delayed.resolve());

    expect(store.getState()).toMatchObject({
      revision: 1,
      room: { name: "Living Room" },
      receipts: [],
    });
  });

  it("invalidates a delayed import across an A to B to A store cycle", async () => {
    const user = userEvent.setup();
    const storeA = createTestStore();
    const storeB = createRoomStore(
      getTemplate("compact-bedroom"),
      {
        resolveProduct: resolveCatalogProduct,
        createItemId: () => "item_store_b",
      },
    );
    const delayed = createDelayedFile(
      serializeWimyRoom(getTemplate("blank-room")),
      "aba.wimy",
    );
    const view = render(<FileAndTemplateControls store={storeA} />);

    await user.upload(
      screen.getByLabelText("Import .wimy file"),
      delayed.file,
    );
    await waitFor(() => expect(delayed.reads).toBe(1));
    view.rerender(<FileAndTemplateControls store={storeB} />);
    view.rerender(<FileAndTemplateControls store={storeA} />);
    await act(async () => delayed.resolve());

    expect(storeA.getState()).toMatchObject({
      revision: 1,
      room: { name: "Living Room" },
      receipts: [],
    });
    expect(storeB.getState()).toMatchObject({
      revision: 1,
      room: { name: "Compact Bedroom" },
      receipts: [],
    });
  });

  it("keeps fixed atomic live regions across safe diagnostic and success attempts", async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<FileAndTemplateControls store={store} />);
    const input = screen.getByLabelText("Import .wimy file");
    const alert = screen.getByRole("alert", { name: "Room file alert" });
    const status = screen.getByRole("status", {
      name: "Portable room action status",
    });

    expect(alert).toBeEmptyDOMElement();
    expect(status).toBeEmptyDOMElement();
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveAttribute("aria-atomic", "true");

    const invalidRoom = getTemplate("blank-room");
    invalidRoom.dimensions.width = 0.5;
    await user.upload(
      input,
      new File(
        [
          JSON.stringify({
            format: "wimy-room",
            schemaVersion: 1,
            room: invalidRoom,
          }),
        ],
        "invalid-room.wimy",
      ),
    );

    await waitFor(() =>
      expect(alert).toHaveTextContent(
        "INVALID_DOCUMENT at room.dimensions.width: Invalid Wimy document",
      ),
    );
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole("alert", { name: "Room file alert" })).toBe(alert);

    await user.upload(
      input,
      new File(
        [serializeWimyRoom(getTemplate("blank-room"))],
        "valid.wimy",
      ),
    );

    await waitFor(() =>
      expect(status).toHaveTextContent("Import attempt 2 accepted"),
    );
    expect(alert).toBeEmptyDOMElement();
    expect(
      screen.getByRole("status", { name: "Portable room action status" }),
    ).toBe(status);

    await user.upload(
      input,
      new File(
        [serializeWimyRoom(getTemplate("living-room"))],
        "valid-again.wimy",
      ),
    );
    await waitFor(() =>
      expect(status).toHaveTextContent("Import attempt 3 accepted"),
    );
    expect(
      screen.getByRole("status", { name: "Portable room action status" }),
    ).toBe(status);
  });

  it("does not resurrect feedback across an A to B to A store cycle", async () => {
    const user = userEvent.setup();
    const storeA = createTestStore();
    const storeB = createRoomStore(
      getTemplate("compact-bedroom"),
      {
        resolveProduct: resolveCatalogProduct,
        createItemId: () => "item_feedback_store_b",
      },
    );
    const view = render(<FileAndTemplateControls store={storeA} />);
    const alert = screen.getByRole("alert", { name: "Room file alert" });
    const status = screen.getByRole("status", {
      name: "Portable room action status",
    });

    await user.upload(
      screen.getByLabelText("Import .wimy file"),
      new File(["{not-json"], "bad.wimy"),
    );
    await waitFor(() =>
      expect(alert).toHaveTextContent("INVALID_JSON:"),
    );

    view.rerender(<FileAndTemplateControls store={storeB} />);
    expect(alert).toBeEmptyDOMElement();
    expect(status).toBeEmptyDOMElement();
    view.rerender(<FileAndTemplateControls store={storeA} />);

    expect(alert).toBeEmptyDOMElement();
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole("alert", { name: "Room file alert" })).toBe(alert);
    expect(
      screen.getByRole("status", { name: "Portable room action status" }),
    ).toBe(status);
  });

  it.each([
    { resolvedCatalogId: "custom-catalog", expectsWarning: false },
    { resolvedCatalogId: "different-catalog", expectsWarning: true },
    { resolvedCatalogId: undefined, expectsWarning: true },
  ])(
    "uses the injected store resolver as current warning authority",
    ({ resolvedCatalogId, expectsWarning }) => {
      const item = makePlacedItem({
        catalogRef: {
          catalogId: "custom-catalog",
          productId: "custom-chair",
        },
      });
      const store = createRoomStore(makeRoom({ items: [item] }), {
        resolveProduct: (productId) =>
          resolvedCatalogId === undefined
            ? undefined
            : {
                catalogRef: { catalogId: resolvedCatalogId, productId },
                snapshot: item.snapshot,
              },
        createItemId: () => "item_generated_1",
      });

      render(
        <>
          <FileAndTemplateControls store={store} />
          <RoomWarnings store={store} />
        </>,
      );

      const warningRegion = screen.getByRole("region", {
        name: "Room warnings",
      });
      expect(warningRegion).toHaveTextContent(
        expectsWarning ? "1 current room warning." : "No current room warnings.",
      );
      const catalogWarning = screen.queryByText(
        "Catalog unavailable; using embedded snapshot.",
      );
      if (expectsWarning) {
        expect(catalogWarning).toBeInTheDocument();
      } else {
        expect(catalogWarning).not.toBeInTheDocument();
      }
    },
  );

  it("renders distinct door warnings with unique keys", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const item = makePlacedItem({ pose: { x: 0.5, y: 1, rotationDeg: 0 } });
    const room = makeRoom({
      items: [item],
      openings: [
        makeOpening({ id: "door_west_1", centerOffset: 1 }),
        makeOpening({ id: "door_west_2", centerOffset: 1 }),
      ],
    });
    const store = createRoomStore(room, {
      resolveProduct: () => undefined,
      createItemId: () => "item_generated_1",
    });

    render(
      <>
        <FileAndTemplateControls store={store} />
        <RoomWarnings store={store} />
      </>,
    );

    const warningRegion = screen.getByRole("region", {
      name: "Room warnings",
    });
    expect(within(warningRegion).getAllByRole("listitem")).toHaveLength(2);
    expect(warningRegion).toHaveTextContent("door_west_1");
    expect(warningRegion).toHaveTextContent("door_west_2");
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((part) => String(part).includes("same key")),
      ),
    ).toBe(false);
  });

  it("bounds a maximum warning room to the deterministic first 50", () => {
    const store = createRoomStore(createMaximumWarningRoom(), {
      resolveProduct: () => undefined,
      createItemId: () => "item_generated_1",
    });

    render(
      <>
        <FileAndTemplateControls store={store} />
        <RoomWarnings store={store} />
      </>,
    );

    const warningRegion = screen.getByRole("region", {
      name: "Room warnings",
    });
    expect(warningRegion).toHaveTextContent("5,150 current room warnings.");
    expect(within(warningRegion).getAllByRole("listitem")).toHaveLength(50);
    expect(warningRegion).toHaveTextContent(
      "Showing the first 50 of 5,150 room warnings.",
    );
  });
});
