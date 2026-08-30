import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRoomStore } from "../room/store";
import { getTemplate } from "../room/templates";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import { App } from "./App";

describe("App", () => {
  it("introduces the shared room workspace", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Wimy" })).toBeVisible();
    expect(screen.getByText(/fit, find, and place/i)).toBeVisible();
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
});
