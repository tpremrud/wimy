import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_CATALOG } from "../room/catalog-data";
import { resolveCatalogProduct } from "../room/catalog";
import { createRoomStore } from "../room/store";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import { PlacedPanel } from "./RoomRailPanels";

afterEach(cleanup);

describe("PlacedPanel orientation", () => {
  it("uses the same nearest legal Pose when rotating from the Placed list", () => {
    const item = makePlacedItem({
      pose: { x: 0.4, y: 1, rotationDeg: 90 },
      snapshot: {
        ...makePlacedItem().snapshot,
        dimensions: { width: 1.2, depth: 0.6, height: 0.8 },
      },
    });
    const store = createRoomStore(
      makeRoom({ items: [item] }),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    render(<PlacedPanel store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Rotate Test Chair" }));

    expect(store.getState()).toMatchObject({
      revision: 2,
      room: {
        items: [
          { id: "item_chair_1", pose: { x: 0.6, y: 1, rotationDeg: 180 } },
        ],
      },
      receipts: [expect.objectContaining({ status: "accepted" })],
    });
  });

  it("shows semantic facing text while keeping rotate and remove actions available", () => {
    const store = createRoomStore(
      makeRoom({
        items: [
          makePlacedItem({
            snapshot: { ...makePlacedItem().snapshot, category: "sofa" },
            pose: { x: 1, y: 1, rotationDeg: 180 },
          }),
        ],
      }),
      TEST_TRANSACTION_DEPENDENCIES,
    );

    render(<PlacedPanel store={store} />);

    expect(screen.getByText("Facing south (180°)")).toBeVisible();
    expect(screen.getByRole("button", { name: "Rotate Test Chair" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove Test Chair" })).toBeVisible();
  });
});

describe("PlacedPanel substitutes", () => {
  it("finds local substitutes for a placed template item without a catalog reference", () => {
    const store = createRoomStore(
      makeRoom({
        items: [
          makePlacedItem({
            snapshot: {
              ...makePlacedItem().snapshot,
              category: "chair",
              name: "Template Lounge Chair",
              dimensions: { width: 0.7, depth: 0.7, height: 0.85 },
              styleTags: ["warm-modern"],
            },
            pose: { x: 1, y: 1, rotationDeg: 0 },
          }),
        ],
      }),
      { createItemId: () => "generated-item", resolveProduct: resolveCatalogProduct },
    );

    render(<PlacedPanel store={store} />);

    const findButton = screen.getByRole("button", {
      name: "Find substitutes for Template Lounge Chair",
    });
    expect(findButton).toBeEnabled();
    fireEvent.click(findButton);

    const replaceButton = screen.getAllByRole("button", {
      name: /^Replace Template Lounge Chair with /u,
    })[0]!;
    expect(
      screen.getByRole("region", { name: "Substitutes for Template Lounge Chair" }),
    ).toContainElement(replaceButton);
    expect(store.getState().revision).toBe(1);

    fireEvent.click(replaceButton);

    expect(store.getState()).toMatchObject({
      revision: 2,
      room: { items: [{ catalogRef: expect.any(Object) }] },
      receipts: [expect.objectContaining({ status: "accepted" })],
    });
  });

  it("shows fit-ranked substitute rationale and requires an explicit human replacement", () => {
    const source = DEMO_CATALOG.find(
      ({ catalogRef }) => catalogRef.productId === "ember-nest-chair",
    );
    if (!source) throw new Error("expected source catalog item");
    const store = createRoomStore(
      makeRoom({
        items: [
          makePlacedItem({
            id: "source-instance",
            catalogRef: source.catalogRef,
            snapshot: source.snapshot,
            pose: { x: 1, y: 1, rotationDeg: 0 },
          }),
        ],
      }),
      { createItemId: () => "generated-item", resolveProduct: resolveCatalogProduct },
    );

    render(<PlacedPanel store={store} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Find substitutes for Ember Nest Chair" }),
    );
    expect(
      screen.getByRole("img", { name: "Cedar Arc Chair preview" }),
    ).toBeVisible();
    const cedarCard = screen.getByText("Cedar Arc Chair").closest("li");
    if (!cedarCard) throw new Error("expected Cedar Arc Chair substitute card");
    expect(within(cedarCard).getByText("Why this match")).toBeVisible();
    expect(
      within(cedarCard).getByText(/Cedar Arc Chair is a comparable substitute for Ember Nest Chair/u),
    ).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Replace Ember Nest Chair with Cedar Arc Chair" })).toBeVisible();
    expect(store.getState().revision).toBe(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Replace Ember Nest Chair with Cedar Arc Chair" }),
    );

    expect(store.getState()).toMatchObject({
      revision: 2,
      room: { items: [{ catalogRef: { productId: "cedar-arc-chair" } }] },
      receipts: [expect.objectContaining({ status: "accepted" })],
    });
  });
});
