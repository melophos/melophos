// recovery: a jump in the middle of a run, a tab that lost its database, a run with nothing played, the dialogs by
// keyboard alone, a tab that vanished and a list that failed to load
import { expect, test, type Page } from "@playwright/test";
import { serveDist } from "../lib/dist-server";

const TWINKLE = ["KeyA", "KeyA", "KeyG", "KeyG", "KeyH", "KeyH", "KeyG", "KeyF", "KeyF", "KeyD", "KeyD", "KeyS", "KeyS", "KeyA"];

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await expect(page.locator("main h1")).toBeVisible();
}

const inDialog = (page: Page) => page.evaluate(() => document.activeElement?.closest("dialog") !== null && document.activeElement?.closest("dialog") !== undefined);
const activeTestId = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.textContent?.trim() ?? "");

async function ownServer(page: Page, devices: () => { status: number; body: unknown }): Promise<void> {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, DELETE" };
  await page.route("https://own.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/signin") return json({ token: "tok" });
    if (url.pathname === "/api/v1/devices") {
      const d = devices();
      return json(d.body, d.status);
    }
    if (url.pathname === "/api/v1/auth/account") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/api/v1/auth/me") return json({ events_used: 0, events_limit: 10, storage_full: false });
    return json({ status: "ok" });
  });
}

async function signInTo(page: Page): Promise<void> {
  await open(page, "/settings/server");
  await page.getByTestId("server-address").fill("https://own.test");
  await page.getByTestId("server-save").click();
  await page.getByLabel("Email").fill("me@example.net");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("server-message")).toContainText("Signed in");
}

test("a run finished straight after Start says nothing was played and is not saved", async ({ page }) => {
  await open(page, "/practise/twinkle");
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible();
  await page.getByTestId("play").click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByTestId("nothing-played")).toContainText("Nothing was played");
  await expect(page.locator("body")).not.toContainText("scoring module did not load");
  await open(page, "/progress");
  await expect(page.getByRole("heading", { name: "Nothing to show yet" })).toBeVisible();
});

test("a tab left open while another deletes everything still saves its next run", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("/#/practise/twinkle");
  await expect(a.locator(".practice[data-engine=ready]")).toBeVisible();
  await b.goto("/#/settings/data");
  await expect(b.getByTestId("delete-everything")).toBeVisible();
  await b.getByTestId("delete-everything").click();
  await b.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(b.getByTestId("data-message")).toContainText("deleted and checked");
  // tab A's connection was closed under it. its run is still saved
  const consoleErrors: string[] = [];
  a.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  await a.getByTestId("play").click();
  for (const k of TWINKLE) await a.keyboard.press(k);
  await expect(a.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(a.getByTestId("save-failed")).toHaveCount(0);
  // tab A saves after its summary shows and the progress page reads the record once when it opens, so B opens it
  // afresh until the saved run is there
  await expect(async () => {
    await b.goto("/#/settings");
    await b.goto("/#/progress");
    await expect(b.getByTestId("days-sentence")).toHaveText("You practised on 1 of the last 28 days.", { timeout: 1000 });
  }).toPass({ timeout: 10000 });
  expect(consoleErrors.filter((e) => /closing/i.test(e))).toEqual([]);
});

test("a run that truly cannot be saved says so on the page and can be tried again", async ({ page }) => {
  await open(page, "/practise/twinkle");
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible();
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.put;
    (window as unknown as { __full: boolean }).__full = true;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "sessions" && (window as unknown as { __full: boolean }).__full) throw new DOMException("The disk is full", "QuotaExceededError");
      return add.apply(this, args);
    };
  });
  await page.getByTestId("play").click();
  for (const k of TWINKLE) await page.keyboard.press(k);
  await expect(page.getByTestId("save-failed")).toContainText("could not be saved, so it will not appear in your progress");
  await page.evaluate(() => ((window as unknown as { __full: boolean }).__full = false));
  await page.getByRole("button", { name: "Try saving again" }).click();
  await expect(page.getByTestId("save-failed")).toHaveCount(0);
});

test("the delete dialogs work by keyboard alone: focus goes in and stays, Escape cancels and focus goes back", async ({ page }) => {
  await open(page, "/settings/data");
  const trigger = page.getByTestId("delete-everything");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog.confirm")).toBeVisible();
  expect(await inDialog(page)).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await inDialog(page), `after ${i + 1} tabs`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.confirm")).toHaveCount(0);
  expect(await activeTestId(page)).toBe("delete-everything");
  // open again and confirm with the keyboard: focus comes back to the button that opened it
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.textContent)).toContain("Yes, delete everything");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("data-message")).toContainText("deleted and checked");
  await expect(page.locator("dialog.confirm")).toHaveCount(0);
  expect(await activeTestId(page)).toBe("delete-everything");
});

test("deleting the account needs the password: the button waits for one and nothing is sent without it", async ({ page }) => {
  const sent: string[] = [];
  await ownServer(page, () => ({ status: 200, body: [] }));
  await page.route("https://own.test/api/v1/auth/account", (route) => {
    sent.push(route.request().method());
    return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
  });
  await signInTo(page);
  await page.getByTestId("delete-account").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog.confirm")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Yes, delete my account" });
  await expect(confirm).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(sent).toEqual([]);
  expect(await activeTestId(page)).toBe("delete-account");
});

test("a list of hubs that fails to load says so and can be tried again", async ({ page }) => {
  let fail = true;
  await ownServer(page, () => (fail ? { status: 500, body: {} } : { status: 200, body: [{ id: "d1", name: "Piano hub", paired_at: "2026-11-22T10:00:00Z" }] }));
  await signInTo(page);
  await open(page, "/devices");
  await expect(page.getByTestId("hubs-failed")).toContainText("could not be loaded");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("hub-list")).toContainText("Piano hub");
  await expect(page.getByTestId("hubs-failed")).toHaveCount(0);
});

test("an update is no longer blocked once the tab that was playing has gone", async ({ context }) => {
  const site = await serveDist();
  try {
    const a = await context.newPage();
    await a.goto(`${site.url}/`);
    await expect(a.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
    await a.reload();
    await expect.poll(() => a.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const b = await context.newPage();
    await b.goto(`${site.url}/`);
    await expect.poll(() => b.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    site.newBuild();
    await b.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await expect(b.getByTestId("update-banner")).toBeVisible({ timeout: 15_000 });
    await a.goto(`${site.url}/#/practise/twinkle?mode=listen`);
    await expect(a.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
    await a.getByTestId("play").click();
    await expect(b.getByTestId("update-banner").getByRole("button")).toBeDisabled();
    // the tab disappears while playing. nothing more is heard from it
    await a.close();
    await expect(b.getByTestId("update-banner").getByRole("button")).toBeEnabled({ timeout: 12_000 });
  } finally {
    await site.close();
  }
});
