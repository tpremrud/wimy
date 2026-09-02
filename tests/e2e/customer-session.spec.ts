import { expect, test } from "@playwright/test";

test("keeps anonymous room and file access while local session UX is optional", async ({ page }) => {
  await page.goto("/");

  const session = page.getByRole("region", { name: "Customer session" });
  await expect(session).toContainText("Anonymous mode");
  await expect(page.getByRole("heading", { name: "Living Room" })).toBeVisible();

  await page.getByRole("tab", { name: "Placed" }).click();
  const placedPanel = page.getByRole("tabpanel", { name: "Placed" });
  await placedPanel
    .getByRole("button", { name: "Find substitutes for Linen Apartment Sofa" })
    .click();
  await expect(
    placedPanel.getByRole("region", { name: "Substitutes for Linen Apartment Sofa" }),
  ).toContainText("is a comparable substitute for Linen Apartment Sofa");

  await page.getByRole("button", { name: "Sign in (optional)" }).click();
  await expect(page.getByRole("textbox", { name: "Demo customer identity" })).toBeVisible();
  await page.getByRole("textbox", { name: "Demo customer identity" }).fill("Demo browser customer");
  await page.getByRole("button", { name: "Continue locally" }).click();
  await expect(session).toContainText("Signed in locally as Demo browser customer");
  await expect(page.locator(".cart-review-panel")).toBeHidden();
  await page.getByRole("button", { name: "Review cart" }).click();
  const cartReview = page.getByRole("dialog", { name: "Cart review" });
  await expect(cartReview.getByRole("region", { name: "Items in this room" })).toContainText(
    "Linen Apartment Sofa",
  );
  await expect(cartReview.getByRole("region", { name: "Items in this room" })).toContainText(
    "Tall Leaf Plant",
  );
  await expect(cartReview).toContainText("No retailer cart lines yet.");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(session).toContainText("Anonymous mode");
  await page.getByRole("button", { name: "Review cart" }).click();
  await expect(page.getByRole("dialog", { name: "Cart review" })).toContainText("Sign in locally to review");

  await page.getByRole("button", { name: "Share room" }).click();
  const share = page.getByRole("dialog", { name: "Share room" });
  await expect(share.getByLabel("Import .wimy file")).toBeVisible();
  await expect(share.getByRole("button", { name: "Export .wimy" })).toBeVisible();
});
