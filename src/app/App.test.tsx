import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("introduces the shared room workspace", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Wimy" })).toBeVisible();
    expect(screen.getByText(/fit, find, and place/i)).toBeVisible();
  });
});
