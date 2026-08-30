import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCatalogProduct } from "../room/catalog";
import { createRoomStore } from "../room/store";
import { getTemplate } from "../room/templates";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import { serializeWimyRoom } from "../room/wimy-file";
import { makePlacedItem } from "../test/room-fixtures";
import { App } from "./App";

type RegisterBehavior = (
  tool: WebMCP.ModelContextTool,
  options?: WebMCP.ModelContextRegisterToolOptions,
) => Promise<void>;

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

class AppModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null =
    null;
  readonly definitions: WebMCP.ModelContextTool[] = [];
  readonly options: (WebMCP.ModelContextRegisterToolOptions | undefined)[] =
    [];

  constructor(private readonly behaviors: RegisterBehavior[] = []) {
    super();
  }

  registerTool(
    tool: WebMCP.ModelContextTool,
    options?: WebMCP.ModelContextRegisterToolOptions,
  ) {
    this.definitions.push(tool);
    this.options.push(options);
    const behavior = this.behaviors[this.definitions.length - 1];
    return behavior ? behavior(tool, options) : Promise.resolve();
  }

  async getTools(): Promise<WebMCP.RegisteredTool[]> {
    return [];
  }
}

const setModelContext = (modelContext: WebMCP.ModelContext | undefined) => {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext,
  });
};

const getWebMcpStatus = () =>
  screen.getByRole("status", { name: "WebMCP status" });

afterEach(() => {
  cleanup();
  setModelContext(undefined);
});

describe("App", () => {
  it("introduces the shared room workspace", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Wimy" })).toBeVisible();
    expect(screen.getByText(/fit, find, and place/i)).toBeVisible();
  });

  it("names the catalog and activity complementary landmarks", () => {
    render(<App />);

    expect(
      screen.getByRole("complementary", { name: "Furniture catalog" }),
    ).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "Activity receipts" }),
    ).toBeVisible();
  });

  it("renders portable room controls without creating an initial transaction", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    render(<App store={store} />);

    const portableControls = screen.getByRole("region", {
      name: "Room files and templates",
    });
    expect(portableControls).toBeVisible();
    expect(
      within(screen.getByRole("banner")).getByRole("region", {
        name: "Room files and templates",
      }),
    ).toBe(portableControls);
    expect(
      within(screen.getByRole("banner")).queryByRole("region", {
        name: "Room warnings",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "Activity receipts" }),
      ).queryByRole("region", { name: "Room files and templates" }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("complementary", { name: "Activity receipts" }),
      ).getByRole("region", { name: "Room warnings" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Load room template" }),
    ).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Undo last room change" }),
    ).toBeDisabled();
    expect(store.getState()).toMatchObject({ revision: 1, receipts: [] });
  });

  it("keeps an imported unavailable-catalog snapshot visible and editable", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const imported = getTemplate("blank-room");
    imported.items.push(
      makePlacedItem({
        id: "item_portable_archive",
        catalogRef: {
          catalogId: "portable-archive",
          productId: "retired-chair",
        },
        snapshot: {
          ...makePlacedItem().snapshot,
          name: "Archived Portable Chair",
          commerce: {
            price: { amount: 199, currency: "USD" },
            productUrl: "https://example.invalid/do-not-open",
          },
        },
      }),
    );
    render(<App store={store} />);

    await user.upload(
      screen.getByLabelText("Import .wimy file"),
      new File([serializeWimyRoom(imported)], "portable.wimy"),
    );

    expect(
      screen.getByText("Catalog unavailable; using embedded snapshot."),
    ).toBeVisible();
    const item = screen.getByRole("button", {
      name: "Select Archived Portable Chair",
    });
    expect(item).toBeVisible();
    await user.click(item);
    await user.click(
      screen.getByRole("button", { name: "Rotate 90 degrees" }),
    );

    expect(store.getState().revision).toBe(3);
    expect(
      store
        .getState()
        .room.items.find(({ id }) => id === "item_portable_archive")?.pose
        .rotationDeg,
    ).toBe(90);
    expect(
      screen.getByText("Catalog unavailable; using embedded snapshot."),
    ).toBeVisible();
  });

  it("renders a supplied store's room, revision, and receipts", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    store.getState().transact({
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

    const view = render(<App store={store} />);
    const app = within(view.container);

    expect(
      app.getByRole("heading", { name: "Living Room" }),
    ).toBeVisible();
    expect(
      within(app.getByRole("region", { name: "Living Room" })).getByText(
        "Revision 2",
      ),
    ).toBeVisible();
    expect(app.getByText("Applied 1 room operations")).toBeVisible();
  });

  it("adds a searched catalog fit through the transaction seam and renders it in 2D", () => {
    const store = createRoomStore(getTemplate("living-room"), {
      resolveProduct: resolveCatalogProduct,
      createItemId: () => "item_catalog_app",
    });
    render(<App store={store} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
      target: { value: "chair" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Style tags" }), {
      target: { value: "warm-modern" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Maximum price (USD)" }),
      { target: { value: "600" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Add best fit" }));

    expect(
      within(screen.getByRole("region", { name: "Living Room" })).getByText(
        "Revision 2",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Select Ember Nest Chair" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Activity receipts" }))
        .getAllByRole("listitem")[0],
    ).toHaveTextContent("Human: Accepted. Added Ember Nest ChairRevision 2");
  });

  it("edits the latest room through one accessible human editor transaction", () => {
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    store.getState().transact({
      expectedRevision: 1,
      origin: "webmcp",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: "item_living_sofa",
            pose: { x: 2.2, y: 0.6 },
          },
        ],
      },
    });

    render(<App store={store} />);
    const chair = screen.getByRole("button", {
      name: "Select Soft Lounge Chair",
    });
    chair.focus();
    fireEvent.keyDown(chair, { key: "Enter" });
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate 90 degrees" }),
    );

    expect(store.getState().revision).toBe(3);
    expect(
      store
        .getState()
        .room.items.find(({ id }) => id === "item_living_chair")?.pose,
    ).toEqual({ x: 1.1, y: 2.3, rotationDeg: 180 });
    expect(store.getState().receipts[0]).toMatchObject({
      origin: "human",
      status: "accepted",
      revision: 3,
      affectedItemIds: ["item_living_chair"],
    });
    expect(
      within(screen.getByRole("region", { name: "Activity receipts" }))
        .getAllByRole("listitem")[0],
    ).toHaveTextContent(
      "Human: Accepted. Applied 1 room operationsRevision 3",
    );
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 1 accepted. Applied 1 room operations. Revision 3.",
    );
    expect(
      screen.queryByRole("button", { name: /Nudge/u }),
    ).not.toBeInTheDocument();
  });

  it("announces every identical rejected human editor action", () => {
    const room = getTemplate("living-room");
    const plant = room.items.find(({ id }) => id === "item_living_plant");
    if (!plant) throw new Error("expected the living-room plant");
    plant.pose.x = 4.575;
    plant.snapshot.dimensions.depth = 0.8;
    const store = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);

    render(<App store={store} />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Select Tall Leaf Plant" }),
      { key: "Enter" },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate 90 degrees" }),
    );

    expect(store.getState().revision).toBe(1);
    expect(store.getState().receipts[0]).toMatchObject({
      origin: "human",
      status: "rejected",
      revision: 1,
      code: "OUT_OF_BOUNDS",
    });
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 1 rejected. The placed item must fit inside the room. Revision 1.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Rotate 90 degrees" }),
    );

    expect(store.getState().revision).toBe(1);
    expect(store.getState().receipts).toHaveLength(2);
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 2 rejected. The placed item must fit inside the room. Revision 1.",
    );
  });

  it("shows pending then unavailable while the human room remains usable", async () => {
    setModelContext(undefined);

    render(<App />);

    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );
    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP unavailable — human room access remains available",
      ),
    );
    expect(screen.getByRole("heading", { name: "Living Room" })).toBeVisible();
  });

  it("reports ready once and aborts registrations without re-registering on room edits", async () => {
    const modelContext = new AppModelContext();
    setModelContext(modelContext);
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    const view = render(<App store={store} />);

    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 2 tools registered",
      ),
    );
    expect(modelContext.definitions.map(({ name }) => name)).toEqual([
      "inspect_room",
      "apply_room_edit",
    ]);

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            { type: "remove", itemId: "item_living_rug" },
          ],
        },
      });
    });

    expect(
      within(screen.getByRole("region", { name: "Living Room" })).getByText(
        "Revision 2",
      ),
    ).toBeVisible();
    expect(modelContext.definitions).toHaveLength(2);
    expect(
      modelContext.options.every(({ signal } = {}) => !signal?.aborted),
    ).toBe(true);

    view.unmount();

    expect(
      modelContext.options.every(({ signal } = {}) => signal?.aborted),
    ).toBe(true);
  });

  it("attempts exactly two live registrations under StrictMode", async () => {
    const modelContext = new AppModelContext();
    setModelContext(modelContext);
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    const view = render(
      <StrictMode>
        <App store={store} />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 2 tools registered",
      ),
    );
    expect(modelContext.definitions.map(({ name }) => name)).toEqual([
      "inspect_room",
      "apply_room_edit",
    ]);
    expect(
      modelContext.options.every(({ signal } = {}) => !signal?.aborted),
    ).toBe(true);

    view.unmount();

    expect(
      modelContext.options.every(({ signal } = {}) => signal?.aborted),
    ).toBe(true);
  });

  it("keeps a rejected registration visibly degraded", async () => {
    const modelContext = new AppModelContext([
      () => Promise.reject(new Error("client refused inspect")),
      () => Promise.resolve(),
    ]);
    setModelContext(modelContext);

    render(<App />);

    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP degraded — 1 of 2 tools registered",
      ),
    );
    expect(getWebMcpStatus()).toHaveTextContent(
      "inspect_room: client refused inspect",
    );
    expect(getWebMcpStatus()).not.toHaveTextContent("WebMCP ready");
  });

  it("renders pending immediately while replacement-store tools register", async () => {
    const inspectSecondStore = createDeferred();
    const applySecondStore = createDeferred();
    const modelContext = new AppModelContext([
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => inspectSecondStore.promise,
      () => applySecondStore.promise,
    ]);
    setModelContext(modelContext);
    const firstStore = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const secondStore = createRoomStore(
      getTemplate("compact-bedroom"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    const view = render(<App store={firstStore} />);
    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 2 tools registered",
      ),
    );

    view.rerender(<App store={secondStore} />);

    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );
    expect(getWebMcpStatus()).not.toHaveTextContent("WebMCP ready");
    await waitFor(() => expect(modelContext.definitions).toHaveLength(4));
    expect(modelContext.options.slice(0, 2).every(
      ({ signal } = {}) => signal?.aborted,
    )).toBe(true);

    inspectSecondStore.resolve();
    await act(() => Promise.resolve());
    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );

    applySecondStore.resolve();
    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 2 tools registered",
      ),
    );
  });
});
