import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomerSessionClient } from "../commerce/customer-session-demo";
import type { CustomerSessionView } from "../commerce/customer-session";
import { CustomerSessionPanel } from "./CustomerSessionPanel";

afterEach(cleanup);

const createClient = (): CustomerSessionClient => {
  let view: CustomerSessionView = { authenticated: false };
  return {
    getSession: async () => view,
    signIn: async (customerId) => {
      view = {
        authenticated: true,
        customerId,
        scopes: ["commerce:cart:read", "commerce:cart:write"],
        expiresAt: 1_801_000,
      };
      return view;
    },
    signOut: async () => {
      view = { authenticated: false };
      return view;
    },
  };
};

describe("CustomerSessionPanel", () => {
  it("offers optional local sign-in while preserving anonymous mode", async () => {
    const user = userEvent.setup();
    render(<CustomerSessionPanel client={createClient()} />);

    expect(screen.getByText("Anonymous mode")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sign in (optional)" }));
    await user.clear(screen.getByRole("textbox", { name: "Demo customer identity" }));
    await user.type(screen.getByRole("textbox", { name: "Demo customer identity" }), "Demo customer");
    await user.click(screen.getByRole("button", { name: "Continue locally" }));

    expect(screen.getByText("Signed in locally as Demo customer")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByText("Anonymous mode")).toBeVisible();
  });

  it("dismisses the optional sign-in popover when the user clicks outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <CustomerSessionPanel client={createClient()} />
        <button type="button">Room surface</button>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Sign in (optional)" }));

    await user.click(screen.getByRole("button", { name: "Room surface" }));

    expect(screen.queryByRole("textbox", { name: "Demo customer identity" }))
      .not.toBeInTheDocument();
  });
});
