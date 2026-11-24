// what the browser really keeps and really deletes. an old-shaped record must not hide the rest, Delete everything must
// delete everything and say so only after looking and an import must be all or nothing
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await expect(page.locator("main h1")).toBeVisible();
}

const good = (id: string, when: string) => ({ id, pieceId: "twinkle", pieceTitle: "Twinkle", startedAt: when, durationMs: 60000, mode: "melody", hand: "both", fromBar: null, toBar: null, speedPct: 100, total: 14, firstTime: 12, wrongPresses: 2, longestRun: 9, score: null, laps: 1, missed: [] });

// puts records straight into the database, as an older version of the app might have left them
async function seed(page: Page, records: unknown[]): Promise<void> {
  await page.evaluate(
    (rs) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("melophos");
        open.onupgradeneeded = () => {
          for (const n of ["sessions", "pieces"]) if (!open.result.objectStoreNames.contains(n)) open.result.createObjectStore(n, { keyPath: "id" });
        };
        open.onsuccess = () => {
          const tx = open.result.transaction("sessions", "readwrite");
          for (const r of rs) tx.objectStore("sessions").put(r);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    records,
  );
}

const sessionsHeld = (page: Page) => page.getByText(/You hold \d+ sessions?/);

test("one record of an old shape does not hide the others", async ({ page }) => {
  await open(page, "/settings/data");
  await seed(page, [{ id: "old-shape" }, good("a", "2026-11-01T10:00:00Z"), { id: "b", startedAt: 42 }]);
  await page.reload();
  await expect(page.getByText("You hold 1 session")).toBeVisible();
  await open(page, "/progress");
  await expect(page.getByRole("heading", { name: "Pieces" })).toBeVisible();
  await expect(page.getByText("Twinkle")).toBeVisible();
});

test("Delete everything deletes the database, the settings, the saved app and the worker and says so only after looking", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 15_000 });
  await open(page, "/settings/data");
  await seed(page, [{ id: "old-shape" }, good("a", "2026-11-01T10:00:00Z")]);
  await page.evaluate(() => localStorage.setItem("melophos.settings", JSON.stringify({ theme: "dark" })));
  await page.reload();
  await page.getByRole("button", { name: "Delete everything" }).first().click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(page.getByTestId("data-message")).toContainText("deleted and checked");
  // the app opens a new empty database to carry on with, so what is checked is that nothing is in it
  const left = await page.evaluate(async () => {
    const records = await new Promise<number>((resolve) => {
      const open = indexedDB.open("melophos");
      open.onsuccess = () => {
        const names = [...open.result.objectStoreNames];
        if (names.length === 0) return resolve(0);
        const tx = open.result.transaction(names, "readonly");
        let n = 0;
        let pending = names.length;
        for (const name of names) {
          const count = tx.objectStore(name).count();
          count.onsuccess = () => {
            n += count.result;
            if (--pending === 0) {
              open.result.close();
              resolve(n);
            }
          };
        }
      };
    });
    return { records, local: localStorage.length, caches: await caches.keys(), workers: (await navigator.serviceWorker.getRegistrations()).length };
  });
  expect(left).toEqual({ records: 0, local: 0, caches: [], workers: 0 });
  await expect(sessionsHeld(page)).toContainText("0 sessions");
});

test("a failed import changes nothing", async ({ page }) => {
  await open(page, "/settings/data");
  await seed(page, [good("keep1", "2026-11-01T10:00:00Z"), good("keep2", "2026-11-02T10:00:00Z")]);
  await page.reload();
  await expect(page.getByText("You hold 2 sessions")).toBeVisible();
  // the browser runs out of space on the third record
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "sessions" && ++calls === 3) throw new DOMException("quota", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  const incoming = Array.from({ length: 5 }, (_, i) => good(`new${i}`, `2026-11-1${i}T10:00:00Z`));
  await page.locator("input[type=file]").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "melophos-studio-export", version: 1, sessions: incoming })) });
  await expect(page.getByTestId("data-message")).toContainText("nothing was changed");
  await page.reload();
  await expect(page.getByText("You hold 2 sessions")).toBeVisible();
});
