import assert from "node:assert/strict";
import { test } from "node:test";
import { openExternalUrl } from "../src/lib/external-url.ts";

test("web external links detach opener and report blocked popups", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const openedWindow = { opener: {} as Window | null };
  let openedUrl = "";
  let openedTarget = "";

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        open: (url: string, target: string) => {
          openedUrl = url;
          openedTarget = target;
          return openedWindow;
        },
      },
    });

    await openExternalUrl("https://example.test/video");
    assert.equal(openedUrl, "https://example.test/video");
    assert.equal(openedTarget, "_blank");
    assert.equal(openedWindow.opener, null);

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { open: () => null },
    });
    await assert.rejects(
      openExternalUrl("https://example.test/video"),
      /浏览器阻止了打开新窗口/u,
    );
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
