import { describe, expect, it } from "vitest";

import { dispatchIntents } from "../src/dispatcher.js";
import { type ParsedCartRequest } from "../src/parsers/cart-request.js";

import {
  DEFAULT_AJAX_CART,
  buildAjaxCartFetch,
  buildMockStandardEventsModule,
  captureEvents,
} from "./helpers/fixtures.js";

function buildCtx(): ReturnType<typeof buildContextHelper> {
  return buildContextHelper();
}
function buildContextHelper() {
  const module = buildMockStandardEventsModule();
  const target = document;
  const fetch = buildAjaxCartFetch(DEFAULT_AJAX_CART);
  return { ctx: { module, target, fetch }, module, target, fetch };
}

describe("dispatchIntents — lines add", () => {
  it("dispatches CartLinesUpdateEvent with action='add'", async () => {
    const { ctx, target } = buildCtx();
    const capture = captureEvents(target, ["shopify:cart:lines-update"]);
    const parsed: ParsedCartRequest = {
      endpoint: "add",
      intents: [
        {
          kind: "lines",
          action: "add",
          lines: [{ merchandiseId: "gid://shopify/ProductVariant/1", quantity: 2 }],
        },
      ],
    };
    const tx = dispatchIntents(parsed, ctx);
    expect(capture.events).toHaveLength(1);
    const event = capture.events[0] as Event & {
      detail: { action: string; lines: unknown[] };
    };
    expect(event.detail.action).toBe("add");
    expect(event.detail.lines).toHaveLength(1);
    const result = await tx.resolveWith();
    expect(result.dispatchedCount).toBe(1);
    expect(result.resolvedCart?.id).toBe("gid://shopify/Cart/abc123");
    capture.teardown();
  });

  it("resolves event.promise with the converted cart", async () => {
    const { ctx, target } = buildCtx();
    const capture = captureEvents(target, ["shopify:cart:lines-update"]);
    const tx = dispatchIntents(
      {
        endpoint: "add",
        intents: [
          {
            kind: "lines",
            action: "add",
            lines: [{ merchandiseId: "gid://shopify/ProductVariant/1", quantity: 1 }],
          },
        ],
      },
      ctx,
    );
    const event = capture.events[0] as Event & {
      promise?: Promise<{ cart: { id: string } }>;
    };
    void tx.resolveWith();
    const resolved = await event.promise;
    expect(resolved?.cart.id).toBe("gid://shopify/Cart/abc123");
    capture.teardown();
  });
});

describe("dispatchIntents — multi-event transaction", () => {
  it("fires lines + note + discount events from one parsed request", async () => {
    const { ctx, target } = buildCtx();
    const capture = captureEvents(target, [
      "shopify:cart:lines-update",
      "shopify:cart:note-update",
      "shopify:cart:discount-update",
    ]);
    const tx = dispatchIntents(
      {
        endpoint: "update",
        intents: [
          {
            kind: "lines",
            action: "update",
            lines: [{ id: "line-1", quantity: 2 }],
          },
          { kind: "note", note: "hi" },
          { kind: "discount", discountCodes: [{ code: "FOO" }] },
        ],
      },
      ctx,
    );
    expect(capture.events).toHaveLength(3);
    expect(capture.events[0]?.type).toBe("shopify:cart:lines-update");
    expect(capture.events[1]?.type).toBe("shopify:cart:note-update");
    expect(capture.events[2]?.type).toBe("shopify:cart:discount-update");
    const result = await tx.resolveWith();
    expect(result.dispatchedCount).toBe(3);
    capture.teardown();
  });
});

describe("dispatchIntents — rejection path", () => {
  it("rejects all pending promises and dispatches CartErrorEvent", async () => {
    const { ctx, target } = buildCtx();
    const capture = captureEvents(target, ["shopify:cart:lines-update", "shopify:cart:error"]);
    const tx = dispatchIntents(
      {
        endpoint: "add",
        intents: [
          {
            kind: "lines",
            action: "add",
            lines: [{ merchandiseId: "gid://shopify/ProductVariant/1", quantity: 1 }],
          },
        ],
      },
      ctx,
    );
    const event = capture.events[0] as Event & {
      promise?: Promise<{ cart: unknown }>;
    };

    tx.rejectWith(new Error("HTTP 500"));

    await expect(event.promise).rejects.toThrow("HTTP 500");
    expect(capture.events.some((e) => e.type === "shopify:cart:error")).toBe(true);
    capture.teardown();
  });

  it("rejects promises but does NOT dispatch CartErrorEvent when only cart fetch fails", async () => {
    const module = buildMockStandardEventsModule();
    const target = document;
    const failingFetch = ((): typeof fetch => {
      const fn = (): Promise<Response> => Promise.reject(new Error("net down"));
      return fn as unknown as typeof fetch;
    })();
    const ctx = { module, target, fetch: failingFetch };
    const capture = captureEvents(target, ["shopify:cart:lines-update", "shopify:cart:error"]);
    const tx = dispatchIntents(
      {
        endpoint: "add",
        intents: [
          {
            kind: "lines",
            action: "add",
            lines: [{ merchandiseId: "gid://shopify/ProductVariant/1", quantity: 1 }],
          },
        ],
      },
      ctx,
    );
    const event = capture.events[0] as Event & {
      promise?: Promise<{ cart: unknown }>;
    };

    const result = await tx.resolveWith();
    expect(result.dispatchedCount).toBe(1);
    expect(result.resolvedCart).toBeNull();
    await expect(event.promise).rejects.toThrow("net down");
    // No CartErrorEvent — the mutation itself succeeded, only the followup cart fetch failed.
    expect(capture.events.filter((e) => e.type === "shopify:cart:error")).toHaveLength(0);
    capture.teardown();
  });
});

describe("dispatchIntents — empty intents", () => {
  it("dispatches nothing and resolves to zero", async () => {
    const { ctx, target } = buildCtx();
    const capture = captureEvents(target, ["shopify:cart:lines-update"]);
    const tx = dispatchIntents({ endpoint: "update", intents: [] }, ctx);
    expect(capture.events).toHaveLength(0);
    const result = await tx.resolveWith();
    expect(result.dispatchedCount).toBe(0);
    expect(result.resolvedCart).toBeNull();
    capture.teardown();
  });
});
