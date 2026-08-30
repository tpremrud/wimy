import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReceiptPanel } from "./ReceiptPanel";

describe("ReceiptPanel", () => {
  it("renders an accepted receipt with origin, summary, and revision", () => {
    render(
      <ReceiptPanel
        receipts={[
          {
            origin: "human",
            status: "accepted",
            revision: 2,
            changeType: "edit",
            summary: "Moved the sofa",
            affectedItemIds: ["item_living_sofa"],
            removedItemIds: [],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Activity receipts" }),
    ).toBeVisible();
    expect(screen.getByText("Human")).toBeVisible();
    expect(screen.getByText("Accepted")).toBeVisible();
    expect(screen.getByText("Moved the sofa")).toBeVisible();
    expect(screen.getByText("Revision 2")).toBeVisible();
  });

  it("renders a rejected agent receipt as untrusted text", () => {
    const summary = "<img src=x onerror=alert(1)> was rejected";
    render(
      <ReceiptPanel
        receipts={[
          {
            origin: "webmcp",
            status: "rejected",
            revision: 7,
            changeType: "edit",
            summary,
            code: "REVISION_CONFLICT",
            affectedItemIds: [],
            removedItemIds: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("Agent")).toBeVisible();
    expect(screen.getByText("Rejected")).toBeVisible();
    expect(screen.getByText(summary)).toBeVisible();
    expect(screen.getByText("Revision 7")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
