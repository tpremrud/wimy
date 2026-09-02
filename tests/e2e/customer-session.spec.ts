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

test("shows the live room revision and product previews in cart review", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_280, height: 800 });
  await page.goto("/");

  await page
    .getByRole("button", { name: "Select Linen Apartment Sofa" })
    .click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Rotate 90 degrees" }).click();
  }
  await expect(page.getByLabel("Current room context")).toContainText(
    "Revision 4",
  );

  await page.getByRole("button", { name: "Sign in (optional)" }).click();
  await page.getByRole("button", { name: "Continue locally" }).click();
  await page.getByRole("button", { name: "Review cart" }).click();

  const cart = page.getByRole("dialog", { name: "Cart review" });
  await expect(cart.getByLabel("Room revision 4")).toBeVisible();
  await expect(cart.getByLabel("Cart revision 1")).toBeVisible();
  await expect(
    cart.getByRole("img", { name: "Linen Apartment Sofa preview" }),
  ).toBeVisible();
  const geometry = await cart.evaluate((element) => {
    const item = element.querySelector(".cart-room-items li");
    const preview = item?.querySelector('[role="img"]');
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      itemHeight: item?.getBoundingClientRect().height ?? 0,
      previewWidth: preview?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.itemHeight).toBeGreaterThanOrEqual(72);
  expect(geometry.previewWidth).toBeGreaterThanOrEqual(64);
  await page.screenshot({ path: testInfo.outputPath("cart-review.png") });
});
