import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
