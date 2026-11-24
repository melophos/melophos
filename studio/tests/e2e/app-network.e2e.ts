// the claim the website makes about the Studio: it requests nothing but the address the player saved for their own server.
// every request the page or its worker makes is recorded. one to any other origin fails the test, in every view, with
// and without a server saved and across the own-server features
import { expect, test, type Page } from "@playwright/test";
import { name, noteOff, noteOn, smf, track } from "../lib/smf";

const VIEWS = ["/", "/try", "/library", "/piece/twinkle", "/practise/twinkle", "/practise/brother-john?mode=rhythm", "/practise/twinkle?mode=listen", "/devices", "/settings/display", "/settings/notes", "/settings/sound", "/settings/input", "/settings/data", "/settings/server", "/progress", "/progress/twinkle", "/about", "/diagnostics", "/nowhere"];

const MIDI = Buffer.from(smf([track([name("Right hand"), noteOn(0, 0, 72), noteOff(240, 0, 72), noteOn(0, 0, 74), noteOff(240, 0, 74)]), track([name("Left hand"), noteOn(0, 1, 48), noteOff(480, 1, 48)])]));

async function visit(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await expect(page.locator("main h1, main h2").first()).toBeVisible();
  await page.waitForTimeout(150);
}

test("the Studio requests nothing but the saved server address", async ({ page, context }) => {
  const appOrigin = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:5182").origin;
  const outside: string[] = [];
  const server: string[] = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, DELETE" };
  // every request of the page and of its worker, whatever it is for
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.origin === "https://own.test") {
      server.push(`${route.request().method()} ${url.pathname}`);
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (url.pathname === "/api/v1/auth/signin") return json({ token: "tok" });
      if (url.pathname === "/api/v1/devices") return json([]);
      if (url.pathname === "/api/v1/sessions") return json({ items: [], next_cursor: null });
      if (url.pathname === "/api/v1/auth/me") return json({ events_used: 0, events_limit: 10, storage_full: false });
      if (url.pathname === "/api/v1/songs") return json({ id: "s1", title: "t", import_state: "queued", note_count: null, hands_method: null, hands_edited: false, import_error: null }, 202);
      return json({ status: "ok" });
    }
    outside.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });

  // 1. a fresh visit to every view, with no server saved
  for (const v of VIEWS) await visit(page, v);
  await visit(page, "/library");
  await page.getByTestId("import-input").setInputFiles({ name: "t.mid", mimeType: "audio/midi", buffer: MIDI });
  await expect(page.getByTestId("import-found")).toBeVisible();
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(page.getByTestId("hand-editor")).toBeVisible();
  expect(outside, "requests to another origin with no server saved").toEqual([]);
  expect(server, "requests to a server nobody saved").toEqual([]);

  // 2. a server is saved. nothing is sent to it until a button is pressed
  await visit(page, "/settings/server");
  await page.getByTestId("server-address").fill("https://own.test");
  await page.getByTestId("server-save").click();
  await expect(page.getByTestId("server-message")).toContainText("Nothing has been sent to it yet");
  for (const v of VIEWS) await visit(page, v);
  expect(server, "the saved server was called without a button press").toEqual([]);

  // 3. the own-server features, each from a button. only the saved address is ever asked
  await visit(page, "/settings/server");
  await page.getByRole("button", { name: "Check the server" }).click();
  await expect(page.getByTestId("server-message")).toContainText("The server answered");
  await page.getByLabel("Email").fill("me@example.net");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("server-message")).toContainText("Signed in");
  await page.getByRole("button", { name: "Read my sessions from the server" }).click();
  await expect(page.getByTestId("server-message")).toContainText("Read 0 sessions");
  await visit(page, "/devices");
  await visit(page, "/progress");
  await visit(page, "/library");
  await page.getByRole("link", { name: /^t\b/ }).first().click();
  await page.getByRole("button", { name: "Send this piece to my server" }).click();
  await expect(page.getByTestId("server-piece-message")).toContainText("Sent");
  expect(server.length).toBeGreaterThan(3);
  expect(outside, "requests to any origin other than the saved server").toEqual([]);
});
