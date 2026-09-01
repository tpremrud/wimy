import {
  act,
  cleanup,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCatalogProduct } from "../room/catalog";
import { createRoomStore, type RoomStore } from "../room/store";
import { getTemplate } from "../room/templates";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import { CatalogPanel } from "./CatalogPanel";

afterEach(cleanup);

const createCatalogStore = (
  room = getTemplate("living-room"),
  createItemId = () => "item_catalog_added",
) =>
  createRoomStore(room, {
    resolveProduct: resolveCatalogProduct,
    createItemId,
  });

const searchForWarmModernChair = async () => {
  const user = userEvent.setup();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Category" }),
    "chair",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Style tags" }),
    "warm-modern",
  );
  await user.type(
    screen.getByRole("spinbutton", { name: "Maximum price (USD)" }),
    "600",
  );
  await user.click(screen.getByRole("button", { name: "Search catalog" }));
  return user;
};

describe("CatalogPanel", () => {
  it("exposes accessible filters, read-only results, and an explicit no-match state", async () => {
    const store = createCatalogStore();
    store.getState().selectItem("item_living_chair");
    const before = store.getState();

    render(<CatalogPanel store={store} />);

    expect(
      screen.getByRole("heading", { name: "Furniture catalog" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Category" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Style tags" }),
    ).toBeVisible();
    expect(
      screen.getByRole("spinbutton", { name: "Maximum price (USD)" }),
    ).toBeVisible();
    expect(
      screen.getByRole("spinbutton", { name: "Maximum width (m)" }),
    ).toBeVisible();
    expect(
      screen.getByRole("spinbutton", { name: "Maximum depth (m)" }),
    ).toBeVisible();

    const user = await searchForWarmModernChair();
    const results = screen.getByRole("list", { name: "Catalog results" });
    expect(within(results).getByText("Ember Nest Chair")).toBeVisible();
    expect(within(results).getByText("$499 USD")).toBeVisible();
    expect(
      within(results).getAllByText("Project-authored procedural geometry · MIT"),
    ).toHaveLength(2);
    expect(within(results).getByText(/x 0\.3 m, y 0\.3 m, rotation 0°/u))
      .toBeVisible();
    expect(store.getState()).toBe(before);

    const styleInput = screen.getByRole("textbox", { name: "Style tags" });
    await user.clear(styleInput);
    await user.type(styleInput, "not-a-demo-style");
    await user.click(screen.getByRole("button", { name: "Search catalog" }));

    expect(
      screen.getByRole("status", { name: "Catalog search result" }),
    ).toHaveTextContent(
      "Search 2 complete: no furniture matches these filters and fits the current room.",
    );
    expect(
      screen.queryByRole("list", { name: "Catalog results" }),
    ).not.toBeInTheDocument();
    expect(store.getState()).toBe(before);
    expect(store.getState()).toMatchObject({
      room: before.room,
      revision: before.revision,
      receipts: before.receipts,
      selectedItemId: "item_living_chair",
      previousRoom: before.previousRoom,
    });
    expect(store.getState().createUndoRequest()).toEqual(
      before.createUndoRequest(),
    );
  });

  it("announces successful and repeated searches without moving focus", async () => {
    const store = createCatalogStore();
    render(<CatalogPanel store={store} />);
    const user = await searchForWarmModernChair();
    const searchButton = screen.getByRole("button", {
      name: "Search catalog",
    });
    const summary = screen.getByRole("status", {
      name: "Catalog search result",
    });

    expect(summary).toHaveTextContent(
      "Search 1 complete: 2 matches. Best match: Ember Nest Chair at x 0.3 m, y 0.3 m, rotation 0°.",
    );
    expect(searchButton).toHaveFocus();

    await user.click(searchButton);

    expect(summary).toHaveTextContent(
      "Search 2 complete: 2 matches. Best match: Ember Nest Chair at x 0.3 m, y 0.3 m, rotation 0°.",
    );
    expect(searchButton).toHaveFocus();
  });

  it("exposes style metadata and adds a targeted fictional record", async () => {
    const store = createCatalogStore(getTemplate("blank-room"));
    render(<CatalogPanel store={store} />);
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Category" }),
      "chair",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Style tags" }),
      "molded-shell, lounge",
    );
    await user.click(screen.getByRole("button", { name: "Search catalog" }));

    const results = screen.getByRole("list", { name: "Catalog results" });
    expect(within(results).getByText("Dune Shell Lounger")).toBeVisible();
    expect(
      within(results).getByText("Styles: organic, molded-shell, lounge"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    expect(store.getState()).toMatchObject({
      revision: 2,
      receipts: [
        {
          origin: "human",
          status: "accepted",
          summary: "Added Dune Shell Lounger",
          affectedItemIds: ["item_catalog_added"],
        },
      ],
    });
    expect(
      store
        .getState()
        .room.items.find(({ id }) => id === "item_catalog_added"),
    ).toMatchObject({
      catalogRef: {
        catalogId: "wimy-demo-v1",
        productId: "dune-shell-lounger",
      },
      snapshot: { name: "Dune Shell Lounger" },
      pose: { x: 0.5, y: 0.5, rotationDeg: 0 },
    });
  });

  it("adds exactly one latest best fit through a Human transaction", async () => {
    const store = createCatalogStore();
    const itemCountBefore = store.getState().room.items.length;
    const user = await (async () => {
      render(<CatalogPanel store={store} />);
      return searchForWarmModernChair();
    })();

    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    const state = store.getState();
    expect(state.revision).toBe(2);
    expect(state.room.items).toHaveLength(itemCountBefore + 1);
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({
      origin: "human",
      status: "accepted",
      revision: 2,
      summary: "Added Ember Nest Chair",
      affectedItemIds: ["item_catalog_added"],
    });
    expect(
      state.room.items.find(({ id }) => id === "item_catalog_added"),
    ).toMatchObject({
      catalogRef: {
        catalogId: "wimy-demo-v1",
        productId: "ember-nest-chair",
      },
      snapshot: { name: "Ember Nest Chair" },
      pose: { x: 0.3, y: 0.3, rotationDeg: 0 },
    });
    expect(
      screen.getByRole("status", { name: "Catalog add result" }),
    ).toHaveTextContent("Accepted: Added Ember Nest Chair. Revision 2.");
    expect(
      screen.getByRole("status", { name: "Catalog search result" }),
    ).toHaveTextContent(
      "Search 1 results refreshed: 2 matches. Best match: Ember Nest Chair at x 0.9 m, y 0.3 m, rotation 0°.",
    );
  });

  it("fails closed when catalog facts change between refresh and transact", async () => {
    let transactionStarted = false;
    const source = createRoomStore(getTemplate("living-room"), {
      resolveProduct: (productId) => {
        const resolved = resolveCatalogProduct(productId);
        if (!resolved || !transactionStarted) return resolved;

        return {
          ...resolved,
          snapshot: {
            ...resolved.snapshot,
            name: "Resolver-Swapped Ember Chair",
          },
        };
      },
      createItemId: () => "item_catalog_swapped",
    });
    const store: RoomStore = {
      getInitialState: source.getInitialState,
      getState: () => {
        const current = source.getState();
        return {
          ...current,
          transact: (request) => {
            transactionStarted = true;
            return current.transact(request);
          },
        };
      },
      subscribe: source.subscribe,
      readCatalog: source.readCatalog,
      resolveProduct: source.resolveProduct,
    };
    render(<CatalogPanel store={store} />);
    const user = await searchForWarmModernChair();
    const roomBefore = source.getState().room;

    expect(
      within(screen.getByRole("list", { name: "Catalog results" })).getByText(
        "Ember Nest Chair",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    const state = source.getState();
    expect(transactionStarted).toBe(true);
    expect(state.room).toBe(roomBefore);
    expect(state.revision).toBe(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({
      origin: "human",
      status: "rejected",
      revision: 1,
      code: "UNKNOWN_PRODUCT",
      affectedItemIds: [],
    });
    expect(state.room.items).not.toContainEqual(
      expect.objectContaining({ id: "item_catalog_swapped" }),
    );
    expect(JSON.stringify(state.room)).not.toContain(
      "Resolver-Swapped Ember Chair",
    );
    expect(
      screen.getByRole("status", { name: "Catalog add result" }),
    ).toHaveTextContent(
      "Rejected: Unknown catalog product ember-nest-chair. Revision 1.",
    );
  });

  it("reruns the latest query against a changed room and revision at activation", async () => {
    const store = createCatalogStore(
      makeRoom({
        dimensions: { width: 2, depth: 2, height: 2.7 },
        items: [
          makePlacedItem({
            id: "item_existing_blocker",
            pose: { x: 1.7, y: 1.7, rotationDeg: 0 },
          }),
        ],
      }),
      () => "item_latest_fit",
    );
    render(<CatalogPanel store={store} />);
    const user = await searchForWarmModernChair();

    expect(
      within(screen.getByRole("list", { name: "Catalog results" })).getByText(
        /x 0\.3 m, y 0\.3 m, rotation 0°/u,
      ),
    ).toBeVisible();

    act(() => {
      const current = store.getState();
      current.transact({
        expectedRevision: current.revision,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: "item_existing_blocker",
              pose: { x: 0.3, y: 0.3 },
            },
          ],
        },
      });
    });

    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    const state = store.getState();
    expect(state.revision).toBe(3);
    expect(state.receipts[0]).toMatchObject({
      origin: "human",
      status: "accepted",
      revision: 3,
      affectedItemIds: ["item_latest_fit"],
    });
    expect(
      state.room.items.find(({ id }) => id === "item_latest_fit")?.pose,
    ).toEqual({ x: 0.9, y: 0.3, rotationDeg: 0 });
    expect(
      screen.getByRole("status", { name: "Catalog search result" }),
    ).toHaveTextContent(
      "Search 1 results refreshed: 2 matches. Best match: Ember Nest Chair at x 1.5 m, y 0.3 m, rotation 0°.",
    );
  });

  it("announces when a latest-state refresh leaves no fit to add", async () => {
    const baseItem = makePlacedItem();
    const store = createRoomStore(
      makeRoom({ dimensions: { width: 1, depth: 1, height: 2.7 } }),
      {
        resolveProduct: (productId) =>
          productId === "fill-room"
            ? {
                catalogRef: {
                  catalogId: "wimy-demo-v1",
                  productId,
                },
                snapshot: {
                  ...baseItem.snapshot,
                  dimensions: { width: 1, depth: 1, height: 0.8 },
                },
              }
            : resolveCatalogProduct(productId),
        createItemId: () => "item_full_blocker",
      },
    );
    render(<CatalogPanel store={store} />);
    const user = await searchForWarmModernChair();

    act(() => {
      const current = store.getState();
      current.transact({
        expectedRevision: current.revision,
        origin: "human",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "fill-room",
              pose: { x: 0.5, y: 0.5, rotationDeg: 0 },
            },
          ],
        },
      });
    });

    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    expect(store.getState().revision).toBe(2);
    expect(store.getState().receipts).toHaveLength(1);
    expect(
      screen.getByRole("status", { name: "Catalog search result" }),
    ).toHaveTextContent(
      "Search 1 results refreshed: no furniture matches these filters and fits the current room.",
    );
    expect(
      screen.getByRole("status", { name: "Catalog add result" }),
    ).toHaveTextContent(
      "No furniture matches these filters and fits the current room.",
    );
    expect(
      screen.queryByRole("list", { name: "Catalog results" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search catalog" }),
    ).toHaveFocus();
  });

  it("restores search focus when an accepted add leaves no remaining fit", async () => {
    const store = createCatalogStore();
    render(<CatalogPanel store={store} />);
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Category" }),
      "bed",
    );
    await user.click(screen.getByRole("button", { name: "Search catalog" }));

    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    expect(store.getState().revision).toBe(2);
    expect(
      screen.getByRole("status", { name: "Catalog search result" }),
    ).toHaveTextContent(
      "Search 1 results refreshed: no furniture matches these filters and fits the current room.",
    );
    expect(
      screen.queryByRole("list", { name: "Catalog results" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search catalog" }),
    ).toHaveFocus();
  });

  it("keeps a rejected add atomic and reports the readable failure", async () => {
    const room = makeRoom({
      items: [
        makePlacedItem({
          id: "item_duplicate",
          pose: { x: 3, y: 2, rotationDeg: 0 },
        }),
      ],
    });
    const store = createCatalogStore(room, () => "item_duplicate");
    render(<CatalogPanel store={store} />);
    const user = await searchForWarmModernChair();
    const roomBefore = store.getState().room;

    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    const state = store.getState();
    expect(state.room).toBe(roomBefore);
    expect(state.revision).toBe(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0]).toMatchObject({
      origin: "human",
      status: "rejected",
      revision: 1,
      code: "INVALID_DOCUMENT",
      affectedItemIds: [],
    });
    expect(
      screen.getByRole("status", { name: "Catalog add result" }),
    ).toHaveTextContent(
      "Rejected: Generated placed-item identity item_duplicate already exists. Revision 1.",
    );
  });

  it("clears ephemeral results after accepted replacement while retaining filters and focus", async () => {
    const store = createCatalogStore();
    render(<CatalogPanel store={store} />);
    await searchForWarmModernChair();
    const addButton = screen.getByRole("button", { name: "Add best fit" });
    addButton.focus();

    act(() => {
      const current = store.getState();
      current.transact({
        expectedRevision: current.revision,
        origin: "template",
        change: { type: "replace", room: getTemplate("blank-room") },
      });
    });

    expect(
      screen.queryByRole("list", { name: "Catalog results" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Catalog add result" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue(
      "chair",
    );
    expect(screen.getByRole("textbox", { name: "Style tags" })).toHaveValue(
      "warm-modern",
    );
    expect(
      screen.getByRole("spinbutton", { name: "Maximum price (USD)" }),
    ).toHaveValue(600);
    expect(
      screen.getByRole("button", { name: "Search catalog" }),
    ).toHaveFocus();
  });

  it("preserves ephemeral results after a rejected replacement", async () => {
    const store = createCatalogStore();
    render(<CatalogPanel store={store} />);
    await searchForWarmModernChair();

    act(() => {
      store.getState().transact({
        expectedRevision: 0,
        origin: "import",
        change: { type: "replace", room: getTemplate("blank-room") },
      });
    });

    expect(
      within(screen.getByRole("list", { name: "Catalog results" })).getByText(
        "Ember Nest Chair",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add best fit" })).toBeVisible();
    expect(store.getState()).toMatchObject({
      revision: 1,
      room: { name: "Living Room" },
    });
  });
});
