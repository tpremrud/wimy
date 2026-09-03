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
  {
    name: "inspect_retailer_offers",
    title: "Inspect retailer offer evidence",
    description: "Read offer evidence.",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    execute: async () => ({}),
  },
  {
    name: "inspect_room_shopping_plan",
    title: "Inspect room shopping plan",
    description: "Read a room shopping plan.",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
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
            registered: ["inspect_room", "find_furniture", "apply_room_edit", "inspect_retailer_offers", "inspect_room_shopping_plan"],
            errors: [],
          },
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "WebMCP tools, 5 registered" });
    expect(trigger).toHaveTextContent("WebMCP · 5 tools");

    await user.click(trigger);
    const panel = screen.getByRole("dialog", { name: "WebMCP tools" });
    expect(panel).toHaveTextContent("5 of 5 registered");
    expect(screen.getAllByText("Registered")).toHaveLength(5);
    expect(screen.getByText("Can change room")).toBeVisible();
    expect(screen.getByText("Available after sign-in")).toBeVisible();
    expect(screen.getByText("inspect_cart")).toBeVisible();
    expect(screen.getByText("find_retailer_offers")).toBeVisible();
    expect(screen.getByText("add_to_cart")).toBeVisible();
    expect(screen.getByText("remove_from_cart")).toBeVisible();
    expect(screen.getByText("set_cart_quantity")).toBeVisible();
    expect(screen.getAllByText("Sign in")).toHaveLength(5);
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

    const trigger = screen.getByRole("button", { name: "WebMCP tools, 5 registered" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Room canvas" }));
    expect(screen.queryByRole("dialog", { name: "WebMCP tools" })).not.toBeInTheDocument();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "WebMCP tools" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows signed-in tools in the registered list without a gated duplicate", async () => {
    const user = userEvent.setup();
    const authenticatedDefinitions = [
      ...definitions,
      {
        name: "inspect_cart",
        title: "Inspect cart",
        description: "Read the cart.",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
        execute: async () => ({}),
      },
    ] satisfies WebMcpToolDefinition[];

    render(
      <WebMcpToolList
        authenticated
        definitions={authenticatedDefinitions}
        registration={{
          phase: "resolved",
          status: {
            available: true,
            registered: authenticatedDefinitions.map(({ name }) => name),
            errors: [],
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "WebMCP tools, 6 registered" }),
    );
    expect(screen.getByText("inspect_cart")).toBeVisible();
    expect(screen.queryByText("Available after sign-in")).not.toBeInTheDocument();
  });
});
