import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { WebMcpToolDefinition } from "../webmcp/room-tools";
import { WebMcpToolList } from "./WebMcpToolList";

const definitions = [
  {
    name: "inspect_room",
    title: "Inspect room",
    description: "Read the current room.",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    execute: async () => ({}),
  },
  {
    name: "find_furniture",
    title: "Find furniture",
    description: "Find catalog fits.",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    execute: async () => ({}),
  },
  {
    name: "apply_room_edit",
    title: "Apply room edit",
    description: "Change the room.",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: false },
    execute: async () => ({}),
  },
] satisfies WebMcpToolDefinition[];

afterEach(cleanup);

describe("WebMcpToolList", () => {
  it("shows the real registration count and the write-capable tool", async () => {
    const user = userEvent.setup();
    render(
      <WebMcpToolList
        definitions={definitions}
        registration={{
          phase: "resolved",
          status: {
            available: true,
            registered: ["inspect_room", "find_furniture", "apply_room_edit"],
            errors: [],
          },
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "WebMCP tools, 3 registered" });
    expect(trigger).toHaveTextContent("WebMCP · 3 tools");

    await user.click(trigger);
    const panel = screen.getByRole("dialog", { name: "WebMCP tools" });
    expect(panel).toHaveTextContent("3 of 3 registered");
    expect(screen.getAllByText("Registered")).toHaveLength(3);
    expect(screen.getByText("Can change room")).toBeVisible();
  });

  it("closes outside and returns focus to the trigger on Escape", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Room canvas</button>
        <WebMcpToolList
          definitions={definitions}
          registration={{
            phase: "resolved",
            status: {
              available: true,
              registered: definitions.map(({ name }) => name),
              errors: [],
            },
          }}
        />
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "WebMCP tools, 3 registered" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Room canvas" }));
    expect(screen.queryByRole("dialog", { name: "WebMCP tools" })).not.toBeInTheDocument();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "WebMCP tools" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
