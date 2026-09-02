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

test("directly drags a window, a door, and the anchored east room wall", async ({ page }) => {
  await page.goto("/");
  const windowControl = page.getByRole("slider", {
    name: "Move window on north wall",
  });
  const initialOpeningOffset = await windowControl.getAttribute("aria-valuenow");
  const windowBounds = await windowControl.boundingBox();
  if (!windowBounds) throw new Error("expected a visible window drag control");

  await page.mouse.move(
    windowBounds.x + windowBounds.width / 2,
    windowBounds.y + windowBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    windowBounds.x + windowBounds.width / 2 + 36,
    windowBounds.y + windowBounds.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect(windowControl).not.toHaveAttribute(
    "aria-valuenow",
    initialOpeningOffset ?? "",
  );
  await expect(page.getByLabel("Current room context")).toContainText("Revision 2");

  const widthControl = page.getByRole("slider", {
    name: "Resize room width from east wall",
  });
  const initialWidth = await widthControl.getAttribute("aria-valuenow");
  const wallBounds = await widthControl.boundingBox();
  if (!wallBounds) throw new Error("expected a visible east wall drag control");
  await page.mouse.move(
    wallBounds.x + wallBounds.width / 2,
    wallBounds.y + wallBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    wallBounds.x + wallBounds.width / 2 + 40,
    wallBounds.y + wallBounds.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect(widthControl).not.toHaveAttribute("aria-valuenow", initialWidth ?? "");
  await expect(page.getByLabel("Current room context")).toContainText("Revision 3");

  const doorControl = page.getByRole("slider", {
    name: "Move door on west wall",
  });
  const initialDoorOffset = await doorControl.getAttribute("aria-valuenow");
  const doorBounds = await doorControl.boundingBox();
  if (!doorBounds) throw new Error("expected a visible door drag control");
  await page.mouse.move(
    doorBounds.x + doorBounds.width / 2,
    doorBounds.y + doorBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    doorBounds.x + doorBounds.width / 2,
    doorBounds.y + doorBounds.height / 2 + 32,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect(doorControl).not.toHaveAttribute(
    "aria-valuenow",
    initialDoorOffset ?? "",
  );
  await expect(page.getByLabel("Current room context")).toContainText("Revision 4");
});
