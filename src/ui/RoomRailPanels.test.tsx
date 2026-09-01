import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRoomStore } from "../room/store";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import { makePlacedItem, makeRoom } from "../test/room-fixtures";
import { PlacedPanel } from "./RoomRailPanels";

describe("PlacedPanel orientation", () => {
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
