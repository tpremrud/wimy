import { chromium, expect, test } from "@playwright/test";

const getBaseUrl = (baseURL: unknown) => {
  if (typeof baseURL !== "string" || !URL.canParse(baseURL)) {
    throw new Error("expected a valid Playwright project baseURL");
  }
  return baseURL;
};

test("preflights unavailable WebGL without mounting Canvas across retries", async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  const baseURL = getBaseUrl(testInfo.project.use.baseURL);
  const browser = await chromium.launch({
    args: ["--disable-webgl", "--disable-software-rasterizer"],
  });
  const page = await browser.newPage({ viewport: { width: 1_280, height: 900 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseURL);

    for (let retry = 0; retry < 3; retry += 1) {
      await page.getByRole("button", { name: "Preview in 3D" }).click();
      await expect(page.getByText(
        "The interactive 3D canvas is unavailable",
      )).toBeVisible();
      await expect(page.locator(".room-preview-canvas canvas")).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "3D preview of Living Room" }),
      ).toContainText("Living Room: 4.8 m by 4.2 m room with 5 placed items.");
      await expect(
        page.getByRole("list", { name: "Placed items in Living Room" }),
      ).toContainText("Linen Apartment Sofa");
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(1_280);
      await page.getByRole("button", { name: "Edit in 2D" }).click();
      await expect(
        page.getByRole("group", { name: "Living Room 2D room editor" }),
      ).toBeVisible();
    }

    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test("keeps normal-WebGL Canvas mounting through repeated view switching", async ({
  page,
}) => {
  await page.goto("/");

  for (let retry = 0; retry < 3; retry += 1) {
    await page.getByRole("button", { name: "Preview in 3D" }).click();
    await expect(page.locator(".room-preview-canvas canvas")).toBeVisible();
    await page.getByRole("button", { name: "Edit in 2D" }).click();
    await expect(
      page.getByRole("group", { name: "Living Room 2D room editor" }),
    ).toBeVisible();
  }
});
