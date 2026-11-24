// importing a MIDI file, correcting the hands and the optional link to the player's own server
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { name, noteOff, noteOn, smf, track } from "../lib/smf";

// two named tracks, so the split is certain to be a guess from the names. the right hand has a low note that is really the left hand's
const FILE = Buffer.from(
  smf([
    track([name("Right hand"), noteOn(0, 0, 72), noteOff(240, 0, 72), noteOn(0, 0, 74), noteOff(240, 0, 74), noteOn(0, 0, 45), noteOff(240, 0, 45), noteOn(0, 0, 76), noteOff(240, 0, 76)]),
    track([name("Left hand"), noteOn(0, 1, 48), noteOff(480, 1, 48), noteOn(0, 1, 43), noteOff(480, 1, 43)]),
  ]),
);

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await expect(page.locator("main h1")).toBeVisible();
}

async function importIt(page: Page): Promise<string> {
  await open(page, "/library");
  await page.getByTestId("import-input").setInputFiles({ name: "my_tune.mid", mimeType: "audio/midi", buffer: FILE });
  await expect(page.getByTestId("import-found")).toBeVisible();
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(page.getByRole("heading", { name: "my tune", level: 1 })).toBeVisible();
  return page.url();
}

test("a file is read in the browser, shown with its guess at the hands and added", async ({ page }) => {
  await open(page, "/library");
  await page.getByTestId("import-input").setInputFiles({ name: "my_tune.mid", mimeType: "audio/midi", buffer: FILE });
  const found = page.getByTestId("import-found");
  await expect(found).toContainText("Notes");
  await expect(found).toContainText("6");
  await expect(found).toContainText("The split into hands is a first guess");
  await expect(found).toContainText("Two tracks are named for a hand");
  // no request left the page for the file
  expect(await new AxeBuilder({ page }).analyze().then((r) => r.violations.map((v) => v.id))).toEqual([]);
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(page.getByTestId("hand-editor")).toContainText("This is a guess made from the file, not a fact about the music");
  await expect(page.getByTestId("hand-editor")).toContainText("You have not corrected it");
  // it stays after a reload, in the library and as a piece
  await page.reload();
  await expect(page.getByTestId("hand-editor")).toBeVisible();
  await open(page, "/library");
  await expect(page.getByText("hands are a first guess")).toBeVisible();
});

test("a file that cannot be read gives a plain reason and adds nothing", async ({ page }) => {
  await open(page, "/library");
  await page.getByTestId("import-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("this is not music at all, just words") });
  await expect(page.getByTestId("import-rejected")).toContainText("not a MIDI file");
  await page.getByTestId("import-input").setInputFiles({ name: "huge.mid", mimeType: "audio/midi", buffer: Buffer.alloc(1024 * 1024 + 10) });
  await expect(page.getByTestId("import-rejected")).toContainText("larger than the 1024 KiB limit");
  await expect(page.getByTestId("import-found")).toHaveCount(0);
});

test("hands can be corrected note by note and by a split point, undone and put back to the guess", async ({ page }) => {
  await importIt(page);
  const editor = page.getByTestId("hand-editor");
  // the guess follows the names: the low note in the right hand track is called right
  const lowRow = editor.locator("tr", { hasText: "A2" });
  await expect(lowRow).toContainText("Right");
  await lowRow.getByRole("button").click();
  await expect(lowRow).toContainText("Left (corrected)");
  await expect(editor).toContainText("You have corrected 1 note");
  await page.getByTestId("undo").click();
  await expect(lowRow).toContainText("Right");
  await expect(editor).toContainText("You have not corrected it");
  // a split point at middle C moves every note below it to the left hand
  await page.getByTestId("split-point").selectOption({ label: "C4" });
  await page.getByTestId("apply-split").click();
  await expect(editor).toContainText("You have corrected");
  await expect(lowRow).toContainText("Left");
  // the corrections are kept with the piece
  await page.reload();
  await expect(page.getByTestId("hand-editor").locator("tr", { hasText: "A2" })).toContainText("Left (corrected)");
  await page.getByTestId("reset-guess").click();
  await expect(page.getByTestId("hand-editor")).toContainText("You have not corrected it");
  expect(await new AxeBuilder({ page }).analyze().then((r) => r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`))).toEqual([]);
});

test("an imported piece can be practised with each hand and scored", async ({ page }) => {
  const url = await importIt(page);
  const id = decodeURIComponent(new URL(url).hash.split("/")[2] ?? "");
  await open(page, `/practise/${id}?hand=right`);
  await expect(page.locator(".practice[data-engine=ready]")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("next-line")).toContainText("right hand");
  await page.getByTestId("play").click();
  // right hand: C5, D5, A2 (guessed right), E5 are the notes of the right track. the computer keys cannot reach them, so
  // the on-screen keys are used
  for (const note of [72, 74, 45, 76]) {
    await page.locator(`.key[data-note='${note}']`).dispatchEvent("pointerdown", { pointerId: 1, button: 0, bubbles: true });
    await page.locator(`.key[data-note='${note}']`).dispatchEvent("pointerup", { pointerId: 1, button: 0, bubbles: true });
  }
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.locator(".facts")).toContainText("4 of 4");
  await open(page, `/practise/${id}?hand=left`);
  await expect(page.getByTestId("next-line")).toContainText("left hand");
});

test("nothing from a server shows until the Studio is linked to one", async ({ page }) => {
  await open(page, "/devices");
  await expect(page.getByTestId("pair")).toHaveCount(0);
  await importIt(page);
  await expect(page.getByTestId("server-piece")).toHaveCount(0);
  await open(page, "/settings/server");
  await expect(page.getByTestId("server-settings")).toContainText("works fully with no server");
  await page.getByTestId("server-address").fill("http://192.168.1.10:8000");
  await page.getByTestId("server-save").click();
  await expect(page.getByTestId("server-message")).toContainText("only works on this machine");
  await open(page, "/devices");
  await expect(page.getByTestId("pair")).toHaveCount(0);
});

// a fake of the server, to prove the Studio sends what the documents say. it is not a real server
async function fakeServer(page: Page): Promise<{ requests: { method: string; path: string; auth: string | null; body: string | null }[] }> {
  const requests: { method: string; path: string; auth: string | null; body: string | null }[] = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, DELETE" };
  await page.route("https://own.test/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    requests.push({ method: req.method(), path: url.pathname + url.search, auth: req.headers()["authorization"] ?? null, body: req.postData() });
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    const song = (over = {}) => ({ id: "song-1", title: "my tune", import_state: "ready", note_count: 6, hands_method: "track_name", hands_edited: false, import_error: null, ...over });
    if (url.pathname === "/api/v1/auth/signin") return json({ token: "tok-123", expires_at: "2030-01-01T00:00:00Z", user: {} });
    if (url.pathname === "/health") return json({ status: "ok" });
    if (url.pathname === "/api/v1/devices/pair") return JSON.parse(req.postData() ?? "{}").code === "ABCDEFGH" ? json({ id: "dev-1", name: "Piano hub" }) : json({ detail: "bad code" }, 404);
    if (url.pathname === "/api/v1/songs" && req.method() === "POST") return json(song({ import_state: "queued" }), 202);
    if (url.pathname === "/api/v1/songs/song-1" && req.method() === "GET") return json(song());
    if (url.pathname === "/api/v1/songs/song-1/notes") {
      // the server's reading of the file: the same six notes in time order with its own split
      const notes = [[0, 72, "right"], [0, 48, "left"], [240, 74, "right"], [480, 45, "right"], [480, 43, "left"], [720, 76, "right"]].sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));
      return json({ items: notes.map((n, idx) => ({ idx, t_ms: n[0], dur_ms: 250, note: n[1], velocity: 90, hand: n[2] })), next_after: null });
    }
    if (url.pathname === "/api/v1/songs/song-1/hands") return json(song({ hands_edited: true }));
    if (url.pathname === "/api/v1/songs/song-1/hands/reset") return json(song());
    if (req.method() === "DELETE" || url.pathname.endsWith("signout-everywhere")) {
      if (url.pathname === "/api/v1/auth/account" && JSON.parse(req.postData() ?? "{}").password !== "right pw") return json({ detail: "wrong" }, 401);
      return route.fulfill({ status: 204, headers: cors });
    }
    if (url.pathname === "/api/v1/devices") return json([{ id: "dev-1", name: "Piano hub", firmware: null, hardware_rev: null, last_seen_at: null, paired_at: "2026-11-22T10:00:00Z" }]);
    if (url.pathname === "/api/v1/sessions") return json({ items: [{ id: "s1", started_at: "2026-11-01T10:00:00Z", song_id: "song-1", mode: "rhythm", summary: { duration_ms: 60000, notes_played: 40 }, accuracy: null, final_speed_ppm: null, score_state: "pending" }, { id: "s2", started_at: "2026-11-02T10:00:00Z", song_id: "song-1", mode: "rhythm", summary: { duration_ms: 60000, notes_played: 40 }, accuracy: 0.9, final_speed_ppm: 900000, score_state: "scored" }], next_cursor: null });
    return json({}, 404);
  });
  return { requests };
}

test("linked to a server: sign in, pair a hub, send a piece and its corrected hands, read sessions with honest score states", async ({ page }) => {
  const server = await fakeServer(page);
  await open(page, "/settings/server");
  await page.getByTestId("server-address").fill("https://own.test");
  await page.getByTestId("server-save").click();
  await expect(page.getByTestId("server-message")).toContainText("Nothing has been sent to it yet");
  expect(server.requests).toHaveLength(0);
  await page.getByLabel("Email").fill("me@example.net");
  await page.getByLabel("Password").fill("a long password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("server-message")).toContainText("Signed in");

  // pairing
  await open(page, "/devices");
  await page.getByTestId("pair-code").fill("zzzz zzzz");
  await page.getByTestId("pair-button").click();
  await expect(page.getByTestId("pair-message")).toContainText("wrong or has expired");
  await page.getByTestId("pair-code").fill("abcd-efgh");
  await page.getByTestId("pair-button").click();
  await expect(page.getByTestId("pair-message")).toContainText("Paired");
  const pair = server.requests.filter((r) => r.path === "/api/v1/devices/pair");
  expect(pair[1]).toMatchObject({ method: "POST", auth: "Bearer tok-123" });
  expect(JSON.parse(pair[1]?.body ?? "{}")).toEqual({ code: "ABCDEFGH" });

  // a piece and its hands
  await importIt(page);
  await page.getByRole("button", { name: "Send this piece to my server" }).click();
  await expect(page.getByTestId("server-piece-message")).toContainText("Sent");
  await page.getByRole("button", { name: "Check on the server" }).click();
  await expect(page.getByTestId("server-piece")).toContainText("The server has read the file");
  // the player moves the low note to the left hand, then sends the correction
  await page.getByTestId("hand-editor").locator("tr", { hasText: "A2" }).getByRole("button").click();
  await page.getByRole("button", { name: "Send my corrected hands" }).click();
  await expect(page.getByTestId("server-piece-message")).toContainText("Sent 1 change");
  const put = server.requests.find((r) => r.method === "PUT");
  expect(put?.path).toBe("/api/v1/songs/song-1/hands");
  expect(JSON.parse(put?.body ?? "{}")).toEqual({ changes: [{ idx: 4, hand: "left" }] });
  await page.getByRole("button", { name: /Put the server.s hands back/ }).click();
  await expect(page.getByTestId("server-piece-message")).toContainText("back to its first guess");
  // the click returns before the request lands, so the fake server's record is polled with a limit
  await expect.poll(() => server.requests.some((r) => r.method === "POST" && r.path === "/api/v1/songs/song-1/hands/reset"), { timeout: 5000 }).toBe(true);

  // sessions: a pending score shows no number
  await open(page, "/settings/server");
  await page.getByLabel("Email").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Read my sessions from the server" }).click();
  await expect(page.getByTestId("server-message")).toContainText("Read 2 sessions");
  await open(page, "/progress");
  await page.getByText("Show these sessions as a table").click();
  const table = page.getByTestId("server-progress").locator("table");
  await expect(table).toContainText("score pending");
  await expect(table).toContainText("90%");
  expect(await new AxeBuilder({ page }).analyze().then((r) => r.violations.map((v) => v.id))).toEqual([]);
});

test("taking data away: each action says what goes, asks first and can be cancelled", async ({ page }) => {
  const server = await fakeServer(page);
  await open(page, "/settings/server");
  await page.getByTestId("server-address").fill("https://own.test");
  await page.getByTestId("server-save").click();
  await page.getByLabel("Email").fill("me@example.net");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("server-delete")).toContainText("may be a child");

  // a hub the owner did not expect can be removed from Devices
  await open(page, "/devices");
  await expect(page.getByTestId("hub-list")).toContainText("Claimed by your account");
  await page.getByRole("button", { name: "Remove Piano hub" }).click();
  await expect(page.getByText("deletes every practice session it stored")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(server.requests.some((r) => r.method === "DELETE")).toBe(false);
  await page.getByRole("button", { name: "Remove Piano hub" }).click();
  await page.getByRole("button", { name: "Yes, remove this hub" }).click();
  // the click returns before the request lands, so the fake server's record is polled with a limit
  await expect.poll(() => server.requests.some((r) => r.method === "DELETE" && r.path === "/api/v1/devices/dev-1"), { timeout: 5000 }).toBe(true);

  // one session
  await open(page, "/settings/server");
  await page.getByRole("button", { name: "Read my sessions from the server" }).click();
  await expect(page.getByTestId("server-message")).toContainText("Read 2 sessions");
  await open(page, "/progress");
  await page.getByText("Show these sessions as a table").click();
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect(page.getByText("This cannot be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Yes, delete this session" }).click();
  // the click returns before the request lands, so the fake server's record is polled with a limit
  await expect.poll(() => server.requests.some((r) => r.method === "DELETE" && r.path === "/api/v1/sessions/s2"), { timeout: 5000 }).toBe(true);

  // the account: a wrong password deletes nothing, the right one does
  await open(page, "/settings/server");
  await page.getByTestId("delete-account").click();
  await expect(page.getByText("for good")).toBeVisible();
  await page.getByLabel("Your password").fill("wrong");
  await page.getByRole("button", { name: "Yes, delete my account" }).click();
  await expect(page.getByTestId("server-message")).toContainText("Nothing was deleted");
  await page.getByTestId("delete-account").click();
  await page.getByLabel("Your password").fill("right pw");
  await page.getByRole("button", { name: "Yes, delete my account" }).click();
  await expect(page.getByTestId("server-message")).toContainText("deleted from the server");
  const del = server.requests.filter((r) => r.path === "/api/v1/auth/account");
  expect(JSON.parse(del[1]?.body ?? "{}")).toEqual({ password: "right pw" });
  await expect(page.getByLabel("Email")).toBeVisible();
});
