import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReceiptPanel } from "./ReceiptPanel";

afterEach(cleanup);

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
    expect(screen.getByText("Accepted.")).toBeVisible();
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
    expect(screen.getByText("Rejected.")).toBeVisible();
    expect(screen.getByText(summary)).toBeVisible();
    expect(screen.getByText("Revision 7")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows only the twenty newest receipts with portable-action labels", () => {
    const origins = ["import", "template", "undo"] as const;
    const receipts = Array.from({ length: 21 }, (_, index) => {
      const revision = 21 - index;
      return {
        origin: origins[index % origins.length] ?? "import",
        status: "accepted" as const,
        revision,
        changeType: "replace" as const,
        summary: `Receipt ${revision}`,
        affectedItemIds: [],
        removedItemIds: [],
      };
    });

    render(<ReceiptPanel receipts={receipts} />);

    const visible = screen.getAllByRole("listitem");
    expect(visible).toHaveLength(20);
    expect(visible[0]).toHaveTextContent("Import: Accepted. Receipt 21");
    expect(visible[19]).toHaveTextContent("Template: Accepted. Receipt 2");
    expect(screen.queryByText("Receipt 1")).not.toBeInTheDocument();
    expect(screen.getAllByText("Undo").length).toBeGreaterThan(0);
  });
});
