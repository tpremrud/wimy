import { expect, test } from "@playwright/test";

test("edits one room into an L shape and adds an opening", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Share room", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share room" });
  await share.getByRole("combobox", { name: "Load room template" }).selectOption("blank-room");
  await page.getByRole("button", { name: "Close share room" }).click();

  await page.getByRole("button", { name: "Room setup" }).click();
  const setup = page.getByRole("dialog", { name: "Room setup" });
  await setup.getByRole("spinbutton", { name: "Room width" }).fill("5");
  await setup.getByRole("combobox", { name: "Room shape" }).selectOption("l-shape");
  await setup.getByRole("button", { name: "Add window" }).click();
  await setup.getByRole("button", { name: "Apply room setup" }).click();

  await expect(setup.getByRole("status")).toContainText("revision 3");
  await expect(page.locator(".room-boundary")).toHaveAttribute(
    "points",
    /^(?:[^ ]+ ){5}[^ ]+$/u,
  );
  await expect(page.getByLabel("Current room context")).toContainText("Revision 3");

  await page.getByRole("button", { name: "Close room setup" }).click();
  await expect(setup).toHaveCount(0);
});
