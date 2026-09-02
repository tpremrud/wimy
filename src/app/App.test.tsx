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
import { StrictMode, useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCatalogProduct } from "../room/catalog";
import { createRoomStore, type RoomStore } from "../room/store";
import { getTemplate } from "../room/templates";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import { serializeWimyRoom } from "../room/wimy-file";
import { makePlacedItem } from "../test/room-fixtures";
import { App } from "./App";

const previewModuleHarness = vi.hoisted(() => ({ evaluations: 0 }));

vi.mock("../ui/RoomPreview3D", () => {
  previewModuleHarness.evaluations += 1;
  return {
    RoomPreview3D: ({ room }: { room: { items: Array<{ snapshot: { name: string } }>; name: string } }) => (
      <section aria-label={`3D preview of ${room.name}`}>
        <div data-testid="three-canvas-host" />
        {room.items.map((item) => <p key={item.snapshot.name}>{item.snapshot.name}</p>)}
      </section>
    ),
  };
});

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => (
    <div data-testid="three-canvas-host">{children}</div>
  ),
  useFrame: () => {},
  useThree: () => ({
    camera: {
      far: 100,
      lookAt: () => {},
      near: 0.1,
      position: { set: () => {} },
      updateProjectionMatrix: () => {},
    },
    gl: { domElement: { setAttribute: () => {} } },
    size: { height: 500, width: 500 },
  }),
}));

vi.mock("@react-three/drei", () => ({
  Grid: () => null,
  OrbitControls: () => null,
}));

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
  readonly activeDefinitions = new Map<string, WebMCP.ModelContextTool>();

  constructor(private readonly behaviors: RegisterBehavior[] = []) {
    super();
  }

  registerTool(
    tool: WebMCP.ModelContextTool,
    options?: WebMCP.ModelContextRegisterToolOptions,
  ) {
    this.definitions.push(tool);
    this.options.push(options);
    this.activeDefinitions.set(tool.name, tool);
    options?.signal?.addEventListener(
      "abort",
      () => {
        if (this.activeDefinitions.get(tool.name) === tool) {
          this.activeDefinitions.delete(tool.name);
        }
      },
      { once: true },
    );
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
  previewModuleHarness.evaluations = 0;
});

describe("App", () => {
  it("keeps agent help closed until explicitly opened", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "Help and agent guidance" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Browser agent guidance" })).not.toBeInTheDocument();
  });

  it("keeps closed activity inert until explicitly opened", () => {
    render(<App />);

    expect(screen.getByRole("complementary", { name: "Activity receipts" })).toHaveAttribute("inert");
  });

  it("collapses the rail without losing the selected tab and restores focus", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Favorites" }));
    const collapse = screen.getByRole("button", { name: "Collapse room tools" });
    await user.click(collapse);

    expect(screen.getByRole("button", { name: "Expand room tools" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Favorites" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Expand room tools" }));
    expect(screen.getByRole("button", { name: "Collapse room tools" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Favorites" })).toBeVisible();
  });

  it("opens Help as a non-layout surface and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<App />);

    const opener = screen.getByRole("button", { name: "Help and agent guidance" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Browser agent guidance" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close browser agent guidance" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Browser agent guidance" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("dismisses each floating header surface when the user clicks elsewhere", async () => {
    const user = userEvent.setup();
    render(<App />);

    const roomView = screen.getByRole("button", { name: "Edit in 2D" });

    await user.click(screen.getByRole("button", { name: "Share room" }));
    expect(screen.getByRole("dialog", { name: "Share room" })).toBeVisible();
    await user.click(roomView);
    expect(screen.queryByRole("dialog", { name: "Share room" })).not.toBeInTheDocument();
    expect(roomView).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Help and agent guidance" }));
    expect(screen.getByRole("dialog", { name: "Browser agent guidance" })).toBeVisible();
    await user.click(roomView);
    expect(screen.queryByRole("dialog", { name: "Browser agent guidance" })).not.toBeInTheDocument();
    expect(roomView).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Warnings & activity" }));
    expect(screen.getByRole("complementary", { name: "Activity receipts" })).not.toHaveAttribute("inert");
    await user.click(roomView);
    expect(screen.getByRole("complementary", { name: "Activity receipts" })).toHaveAttribute("inert");
    expect(roomView).toHaveFocus();
  });

  it("keeps only one overlay active and puts real file controls in Share", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Share room" }));
    const share = screen.getByRole("dialog", { name: "Share room" });
    expect(within(share).getByRole("combobox", { name: "Load room template" })).toBeVisible();
    expect(within(share).getByLabelText("Import .wimy file")).toBeVisible();
    expect(within(share).getByRole("button", { name: "Export .wimy" })).toBeVisible();
    expect(within(share).getByRole("button", { name: "Undo last room change" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Help and agent guidance" }));
    expect(screen.queryByRole("dialog", { name: "Share room" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Browser agent guidance" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Share room" }));
    expect(screen.queryByRole("dialog", { name: "Browser agent guidance" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Share room" })).toBeVisible();
  });

  it("opens activity feedback after an accepted catalog transaction", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      {
        resolveProduct: resolveCatalogProduct,
        createItemId: () => "item_generated_1",
      },
    );
    render(<App store={store} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "chair");
    await user.type(screen.getByRole("textbox", { name: "Style tags" }), "warm-modern");
    await user.type(screen.getByRole("spinbutton", { name: "Maximum price (USD)" }), "600");
    await user.click(screen.getByRole("button", { name: "Search catalog" }));
    await user.click(screen.getByRole("button", { name: "Add best fit" }));

    expect(screen.getByRole("complementary", { name: "Activity receipts" })).not.toHaveAttribute("inert");
    expect(screen.getByRole("complementary", { name: "Activity receipts" })).toHaveTextContent("Added Ember Nest Chair");
  });

  it("keeps Share open for its own file transaction feedback", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    render(<App store={store} />);

    await user.click(screen.getByRole("button", { name: "Share room" }));
    const share = screen.getByRole("dialog", { name: "Share room" });
    await user.selectOptions(
      within(share).getByRole("combobox", { name: "Load room template" }),
      "compact-bedroom",
    );

    expect(screen.getByRole("dialog", { name: "Share room" })).toBeVisible();
    expect(within(share).getByRole("status", { name: "Portable room action status" })).toHaveTextContent("accepted");
    await user.click(screen.getByRole("button", { name: "Close share room" }));
    expect(screen.queryByRole("dialog", { name: "Share room" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Activity receipts" })).toHaveAttribute("inert");
  });

  it("opens Activity when a new receipt replaces the capped newest receipt", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    for (let index = 0; index < 20; index += 1) {
      const result = store.getState().transact({
        expectedRevision: index + 1,
        origin: "human",
        change: { type: "replace", room: getTemplate("living-room") },
      });
      expect(result.ok).toBe(true);
    }
    expect(store.getState().receipts).toHaveLength(20);

    render(<App store={store} />);
    await user.click(screen.getByRole("button", { name: "Warnings & activity" }));
    await user.click(screen.getByRole("button", { name: "Close warnings and activity" }));
    expect(screen.getByRole("complementary", { name: "Activity receipts" })).toHaveAttribute("inert");

    const result = store.getState().transact({
      expectedRevision: 21,
      origin: "human",
      change: { type: "replace", room: getTemplate("compact-bedroom") },
    });
    expect(result.ok).toBe(true);
    expect(store.getState().receipts).toHaveLength(20);
    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Activity receipts" })).not.toHaveAttribute("inert"),
    );
    expect(screen.getByRole("complementary", { name: "Activity receipts" })).toHaveTextContent("Replaced the room with Compact Bedroom");
  });

  it("presents the room in a two-pane shell with accessible secondary tabs", () => {
    render(<App />);

    expect(screen.getByRole("tablist", { name: "Room tools" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Add" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Placed" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "Favorites" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("region", { name: "Living Room" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Share room" })).toBeVisible();
  });

  it("shows contextual item controls without making the user open Placed", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("tab", { name: "Add" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(
      screen.getByRole("button", { name: "Select Linen Apartment Sofa" }),
    );

    expect(
      screen.getByRole("group", { name: "Selected item actions" }),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Add" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Placed" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("moves through room tool tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<App />);

    const addTab = screen.getByRole("tab", { name: "Add" });
    addTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Placed" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Placed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Favorites" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Favorites" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps placed items live and exposes transaction-backed actions", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    render(<App store={store} />);

    await user.click(screen.getByRole("tab", { name: "Placed" }));

    const placed = screen.getByRole("tabpanel", { name: "Placed" });
    expect(within(placed).getByText("Tall Leaf Plant")).toBeVisible();
    await user.click(
      within(placed).getByRole("button", { name: "Rotate Tall Leaf Plant" }),
    );
    expect(store.getState().revision).toBe(2);
    expect(store.getState().receipts[0]?.origin).toBe("human");
  });

  it("keeps favorites out of the canonical room and export receipts", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      { ...TEST_TRANSACTION_DEPENDENCIES, resolveProduct: resolveCatalogProduct },
    );
    const before = store.getState();
    render(<App store={store} />);

    await user.click(screen.getByRole("tab", { name: "Add" }));
    await user.click(
      screen.getByRole("button", { name: "Add Ember Nest Chair to favorites" }),
    );
    await user.click(screen.getByRole("tab", { name: "Favorites" }));

    expect(
      within(screen.getByRole("tabpanel", { name: "Favorites" })).getByText(
        "Ember Nest Chair",
      ),
    ).toBeVisible();
    expect(store.getState()).toMatchObject({
      room: before.room,
      revision: before.revision,
      receipts: before.receipts,
    });
  });

  it("opens the accountless share panel and returns focus on close", async () => {
    const user = userEvent.setup();
    render(<App />);

    const shareButton = screen.getByRole("button", { name: "Share room" });
    await user.click(shareButton);
    expect(screen.getByRole("dialog", { name: "Share room" })).toBeVisible();
    expect(screen.getByText(/No account or network is required/i)).toBeVisible();
    const shareDialog = screen.getByRole("dialog", { name: "Share room" });
    expect(within(shareDialog).getByText("Import Wimy File")).toBeVisible();
    expect(within(shareDialog).getByText("Download Wimy File")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close share room" }));
    expect(shareButton).toHaveFocus();
  });

  it("introduces the shared room workspace", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Wimy" })).toBeVisible();
    expect(screen.getByText(/fit, find, and place/i)).toBeVisible();
  });

  it("keeps inspect-find-apply guidance behind the Help entry point", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByText("Inspect the room dimensions and placed items.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Help and agent guidance" }));
    expect(screen.getByRole("dialog", { name: "Browser agent guidance" })).toBeVisible();
    expect(screen.getByText("Inspect the room dimensions and placed items.")).toBeVisible();
  });

  it("provides keyboard users a skip link to the room workspace", () => {
    render(<App />);

    const skipLink = screen.getByRole("link", {
      name: "Skip to room workspace",
    });
    expect(skipLink).toHaveAttribute("href", "#room-workspace");
    expect(document.getElementById("room-workspace")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("does not evaluate the 3D module until preview activation", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    render(<App store={store} />);
    expect(previewModuleHarness.evaluations).toBe(0);

    await user.click(screen.getByRole("button", { name: "Preview in 3D" }));
    await screen.findByRole("region", { name: "3D preview of Living Room" });
    expect(previewModuleHarness.evaluations).toBe(1);
    expect(store.getState()).toMatchObject({ revision: 1, receipts: [] });
  });

  it("keeps the canonical workspace usable when the lazy 3D module rejects", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<App previewLoadFailure store={store} />);
    await user.click(screen.getByRole("button", { name: "Preview in 3D" }));

    const preview = await screen.findByRole("region", {
      name: "3D preview of Living Room",
    });
    expect(within(preview).getByRole("status")).toHaveTextContent(
      "The interactive 3D preview could not load",
    );
    expect(preview).toHaveTextContent(
      "Living Room: 4.8 m by 4.2 m room with 5 placed items.",
    );
    expect(preview).toHaveTextContent("Linen Apartment Sofa");
    expect(store.getState()).toMatchObject({ revision: 1, receipts: [] });

    await user.click(screen.getByRole("button", { name: "Return to 2D editor" }));
    await user.click(
      screen.getByRole("button", { name: "Select Linen Apartment Sofa" }),
    );
    expect(screen.getByRole("button", { name: "Rotate 90 degrees" })).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "Furniture catalog" }),
    ).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "Activity receipts" }),
    ).toBeVisible();
    expect(consoleError).toHaveBeenCalled();
  });

  it("derives a read-only 3D preview from the current room", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    render(<App store={store} />);

    await user.click(screen.getByRole("button", { name: "Preview in 3D" }));

    const preview = await screen.findByRole("region", {
      name: "3D preview of Living Room",
    });
    expect(preview).toContainElement(screen.getByTestId("three-canvas-host"));
    expect(preview).toHaveTextContent("Linen Apartment Sofa");
    expect(preview).toHaveTextContent("Soft Lounge Chair");
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument();
    expect(store.getState()).toMatchObject({ revision: 1, receipts: [] });
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

  it("renders portable room controls inside Share without creating an initial transaction", async () => {
    const user = userEvent.setup();
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    render(<App store={store} />);

    expect(screen.queryByRole("region", { name: "Room files and templates" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share room" }));
    const share = screen.getByRole("dialog", { name: "Share room" });
    const portableControls = within(share).getByRole("region", {
      name: "Room files and templates",
    });
    expect(portableControls).toBeVisible();
    expect(portableControls.closest(".share-panel")).not.toBeNull();
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
      within(share).getByRole("combobox", { name: "Load room template" }),
    ).toHaveValue("");
    expect(
      within(share).getByRole("button", { name: "Undo last room change" }),
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

    await user.click(screen.getByRole("button", { name: "Share room" }));

    await user.upload(
      within(screen.getByRole("dialog", { name: "Share room" })).getByLabelText("Import .wimy file"),
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
    plant.pose = { x: 2.4, y: 2.1, rotationDeg: 90 };
    plant.snapshot.dimensions.width = 4.1;
    plant.snapshot.dimensions.depth = 4.7;
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
    expect(
      screen.getByRole("button", { name: "WebMCP tools unavailable" }),
    ).toHaveTextContent("WebMCP unavailable");
    expect(screen.getByRole("heading", { name: "Living Room" })).toBeVisible();
  });

  it("reports ready once and aborts registrations without re-registering on room edits", async () => {
    const user = userEvent.setup();
    const modelContext = new AppModelContext();
    setModelContext(modelContext);
    const store = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    const view = render(<App store={store} />);

    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 6 tools registered",
      ),
    );
    expect(modelContext.definitions.map(({ name }) => name)).toEqual([
      "inspect_room",
      "find_furniture",
      "apply_room_edit",
      "inspect_retailer_offers",
      "inspect_room_shopping_plan",
      "find_substitutes",
    ]);
    const toolsTrigger = screen.getByRole("button", {
      name: "WebMCP tools, 6 registered",
    });
    expect(toolsTrigger).toHaveTextContent("WebMCP · 6 tools");
    await user.click(toolsTrigger);
    const toolsPanel = screen.getByRole("dialog", { name: "WebMCP tools" });
    expect(toolsPanel).toHaveTextContent("inspect_room");
    expect(toolsPanel).toHaveTextContent("find_furniture");
    expect(toolsPanel).toHaveTextContent("apply_room_edit");
    expect(toolsPanel).toHaveTextContent("inspect_retailer_offers");
    expect(toolsPanel).toHaveTextContent("inspect_room_shopping_plan");
    expect(toolsPanel).toHaveTextContent("find_substitutes");

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
    expect(modelContext.definitions).toHaveLength(6);
    expect(
      modelContext.options.every(({ signal } = {}) => !signal?.aborted),
    ).toBe(true);

    view.unmount();

    expect(
      modelContext.options.every(({ signal } = {}) => signal?.aborted),
    ).toBe(true);
  });

  it("attempts exactly six live registrations under StrictMode", async () => {
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
        "WebMCP ready — 6 tools registered",
      ),
    );
    expect(modelContext.definitions.map(({ name }) => name)).toEqual([
      "inspect_room",
      "find_furniture",
      "apply_room_edit",
      "inspect_retailer_offers",
      "inspect_room_shopping_plan",
      "find_substitutes",
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
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => Promise.reject(new Error("client refused apply")),
    ]);
    setModelContext(modelContext);

    render(<App />);

    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP degraded — 5 of 6 tools registered",
      ),
    );
    expect(getWebMcpStatus()).toHaveTextContent(
      "apply_room_edit: client refused apply",
    );
    expect(getWebMcpStatus()).not.toHaveTextContent("WebMCP ready");
    expect(
      screen.getByRole("button", { name: "WebMCP tools, 5 registered" }),
    ).toHaveTextContent("WebMCP · 5/6 tools");
  });

  it("renders pending immediately while replacement-store tools register", async () => {
    const inspectSecondStore = createDeferred();
    const findSecondStore = createDeferred();
    const applySecondStore = createDeferred();
    const offerSecondStore = createDeferred();
    const planSecondStore = createDeferred();
    const substituteSecondStore = createDeferred();
    const modelContext = new AppModelContext([
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => Promise.resolve(),
      () => inspectSecondStore.promise,
      () => findSecondStore.promise,
      () => applySecondStore.promise,
      () => offerSecondStore.promise,
      () => planSecondStore.promise,
      () => substituteSecondStore.promise,
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
        "WebMCP ready — 6 tools registered",
      ),
    );

    view.rerender(<App store={secondStore} />);

    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );
    expect(getWebMcpStatus()).not.toHaveTextContent("WebMCP ready");
    await waitFor(() => expect(modelContext.definitions).toHaveLength(12));
    expect(modelContext.options.slice(0, 6).every(
      ({ signal } = {}) => signal?.aborted,
    )).toBe(true);

    inspectSecondStore.resolve();
    await act(() => Promise.resolve());
    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );

    findSecondStore.resolve();
    await act(() => Promise.resolve());
    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );

    applySecondStore.resolve();
    await act(() => Promise.resolve());
    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );

    offerSecondStore.resolve();
    await act(() => Promise.resolve());
    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );
    planSecondStore.resolve();
    await act(() => Promise.resolve());
    expect(getWebMcpStatus()).toHaveTextContent(
      "WebMCP registration pending",
    );
    substituteSecondStore.resolve();
    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 6 tools registered",
      ),
    );
  });

  it("invalidates old-store tools before replacement layout observers can invoke them", async () => {
    const modelContext = new AppModelContext();
    setModelContext(modelContext);
    const firstStore = createRoomStore(
      getTemplate("living-room"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const secondStore = createRoomStore(
      getTemplate("compact-bedroom"),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    let replacementProbe:
      | { active: false }
      | {
          active: true;
          inspectedRoom: string;
          applyResult: unknown;
        }
      | undefined;

    const ReplacementProbe = ({ store }: { store: RoomStore }) => {
      useLayoutEffect(() => {
        if (store !== secondStore) return;
        const inspect = modelContext.activeDefinitions.get("inspect_room");
        const apply = modelContext.activeDefinitions.get("apply_room_edit");
        if (!inspect || !apply) {
          replacementProbe = { active: false };
          return;
        }

        const signal = new AbortController().signal;
        const inspected = inspect.execute({}, { signal }) as {
          room: { name: string };
        };
        replacementProbe = {
          active: true,
          inspectedRoom: inspected.room.name,
          applyResult: apply.execute(
            {
              expectedRevision: 1,
              operations: [
                { type: "remove", itemId: "item_living_rug" },
              ],
            },
            { signal },
          ),
        };
      }, [store]);

      return <App store={store} />;
    };

    const view = render(<ReplacementProbe store={firstStore} />);
    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 6 tools registered",
      ),
    );

    view.rerender(<ReplacementProbe store={secondStore} />);

    expect(replacementProbe).toEqual({ active: false });
    expect(firstStore.getState()).toMatchObject({ revision: 1, receipts: [] });
    expect(secondStore.getState()).toMatchObject({ revision: 1, receipts: [] });

    await waitFor(() =>
      expect(modelContext.activeDefinitions.size).toBe(6),
    );
    const replacementInspect =
      modelContext.activeDefinitions.get("inspect_room");
    if (!replacementInspect) {
      throw new Error("replacement inspect_room was not active");
    }
    await expect(
      Promise.resolve(
        replacementInspect.execute(
          {},
          { signal: new AbortController().signal },
        ),
      ),
    ).resolves.toMatchObject({
      revision: 1,
      room: { name: "Compact Bedroom" },
    });
  });

  it("rejects captured handlers after an A to B to A registration lifetime ends", async () => {
    const modelContext = new AppModelContext();
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
        "WebMCP ready — 6 tools registered",
      ),
    );
    const capturedFirstGeneration = modelContext.definitions.slice(0, 6);

    view.rerender(<App store={secondStore} />);
    await waitFor(() => expect(modelContext.definitions).toHaveLength(12));
    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 6 tools registered",
      ),
    );

    view.rerender(<App store={firstStore} />);
    await waitFor(() => expect(modelContext.definitions).toHaveLength(18));
    await waitFor(() =>
      expect(getWebMcpStatus()).toHaveTextContent(
        "WebMCP ready — 6 tools registered",
      ),
    );

    expect(modelContext.definitions.map(({ name }) => name)).toEqual([
      "inspect_room",
      "find_furniture",
      "apply_room_edit",
      "inspect_retailer_offers",
      "inspect_room_shopping_plan",
      "find_substitutes",
      "inspect_room",
      "find_furniture",
      "apply_room_edit",
      "inspect_retailer_offers",
      "inspect_room_shopping_plan",
      "find_substitutes",
      "inspect_room",
      "find_furniture",
      "apply_room_edit",
      "inspect_retailer_offers",
      "inspect_room_shopping_plan",
      "find_substitutes",
    ]);

    expect(
      modelContext.options.slice(0, 12).every(
        ({ signal } = {}) => signal?.aborted,
      ),
    ).toBe(true);
    expect(
      modelContext.options.slice(12).every(
        ({ signal } = {}) => !signal?.aborted,
      ),
    ).toBe(true);

    const freshSignal = () => new AbortController().signal;
    const invocations = [
      () =>
        capturedFirstGeneration[0]?.execute({}, { signal: freshSignal() }),
      () =>
        capturedFirstGeneration[1]?.execute(
          { limit: 1 },
          { signal: freshSignal() },
        ),
      () =>
        capturedFirstGeneration[2]?.execute(
          {
            expectedRevision: 1,
            operations: [{ type: "remove", itemId: "item_living_rug" }],
          },
          { signal: freshSignal() },
        ),
    ].map((invoke) => Promise.resolve().then(invoke));

    const settlements = await Promise.allSettled(invocations);
    expect(settlements).toHaveLength(3);
    expect(
      settlements.every(
        (settlement) =>
          settlement.status === "rejected" &&
          (settlement.reason as { name?: string }).name === "AbortError",
      ),
    ).toBe(true);
    expect(firstStore.getState()).toMatchObject({ revision: 1, receipts: [] });
    expect(secondStore.getState()).toMatchObject({ revision: 1, receipts: [] });

    const currentInspect = modelContext.definitions[12];
    if (!currentInspect) throw new Error("current inspect_room was not active");
    await expect(
      Promise.resolve(
        currentInspect.execute({}, { signal: freshSignal() }),
      ),
    ).resolves.toMatchObject({
      revision: 1,
      room: { name: "Living Room" },
    });
  });
});
