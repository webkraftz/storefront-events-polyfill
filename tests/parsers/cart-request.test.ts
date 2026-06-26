import { describe, expect, it } from "vitest";

import { matchCartEndpoint, parseCartRequest } from "../../src/parsers/cart-request.js";

describe("matchCartEndpoint", () => {
  it("matches /cart/add.js", () => {
    expect(matchCartEndpoint("/cart/add.js")).toBe("add");
    expect(matchCartEndpoint("https://shop.myshopify.com/cart/add.js")).toBe("add");
    expect(matchCartEndpoint("/cart/add.js?return_to=/cart")).toBe("add");
  });

  it("matches /cart/change.js", () => {
    expect(matchCartEndpoint("/cart/change.js")).toBe("change");
  });

  it("matches /cart/update.js", () => {
    expect(matchCartEndpoint("/cart/update.js")).toBe("update");
  });

  it("matches /cart/clear.js", () => {
    expect(matchCartEndpoint("/cart/clear.js")).toBe("clear");
  });

  it("matches without the .js suffix", () => {
    expect(matchCartEndpoint("/cart/add")).toBe("add");
  });

  it("rejects non-cart URLs", () => {
    expect(matchCartEndpoint("/cart.js")).toBeNull();
    expect(matchCartEndpoint("/products/foo.js")).toBeNull();
    expect(matchCartEndpoint("/")).toBeNull();
    expect(matchCartEndpoint("/admin/api/cart/add.js")).toBe("add"); // permissive — admin proxy may pass through
  });
});

describe("parseCartRequest — /cart/add.js", () => {
  it("parses single-item shorthand body", () => {
    const result = parseCartRequest("/cart/add.js", JSON.stringify({ id: 12345, quantity: 2 }));
    expect(result).not.toBeNull();
    expect(result?.endpoint).toBe("add");
    expect(result?.intents).toHaveLength(1);
    const intent = result?.intents[0];
    expect(intent?.kind).toBe("lines");
    if (intent?.kind === "lines") {
      expect(intent.action).toBe("add");
      expect(intent.lines).toEqual([
        { merchandiseId: "gid://shopify/ProductVariant/12345", quantity: 2 },
      ]);
    }
  });

  it("parses items[] array body", () => {
    const body = JSON.stringify({
      items: [
        { id: 1, quantity: 1 },
        { id: 2, quantity: 3 },
      ],
    });
    const result = parseCartRequest("/cart/add.js", body);
    const intent = result?.intents[0];
    expect(intent?.kind).toBe("lines");
    if (intent?.kind === "lines") {
      expect(intent.lines).toHaveLength(2);
      expect(intent.lines[0]).toEqual({
        merchandiseId: "gid://shopify/ProductVariant/1",
        quantity: 1,
      });
      expect(intent.lines[1]).toEqual({
        merchandiseId: "gid://shopify/ProductVariant/2",
        quantity: 3,
      });
    }
  });

  it("defaults quantity to 1 when omitted", () => {
    const result = parseCartRequest("/cart/add.js", JSON.stringify({ id: 99 }));
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.lines[0]?.quantity).toBe(1);
    }
  });

  it("filters out items with zero/negative quantity", () => {
    const body = JSON.stringify({
      items: [
        { id: 1, quantity: 0 },
        { id: 2, quantity: -1 },
        { id: 3, quantity: 5 },
      ],
    });
    const result = parseCartRequest("/cart/add.js", body);
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.lines).toHaveLength(1);
      expect(intent.lines[0]?.quantity).toBe(5);
    }
  });

  it("parses form-urlencoded body", () => {
    const result = parseCartRequest("/cart/add.js", "id=42&quantity=2");
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.lines[0]).toEqual({
        merchandiseId: "gid://shopify/ProductVariant/42",
        quantity: 2,
      });
    }
  });

  it("returns empty intents on undefined body", () => {
    const result = parseCartRequest("/cart/add.js", undefined);
    expect(result?.intents).toHaveLength(0);
  });

  it("preserves a pre-GID merchandiseId", () => {
    const result = parseCartRequest(
      "/cart/add.js",
      JSON.stringify({ id: "gid://shopify/ProductVariant/777", quantity: 1 }),
    );
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.lines[0]?.merchandiseId).toBe("gid://shopify/ProductVariant/777");
    }
  });
});

describe("parseCartRequest — /cart/change.js", () => {
  it("parses an update (quantity > 0)", () => {
    const result = parseCartRequest(
      "/cart/change.js",
      JSON.stringify({ id: "line-key-abc", quantity: 3 }),
    );
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.action).toBe("update");
      expect(intent.lines).toEqual([{ id: "line-key-abc", quantity: 3 }]);
    }
  });

  it("parses a removal (quantity === 0)", () => {
    const result = parseCartRequest(
      "/cart/change.js",
      JSON.stringify({ id: "line-key-abc", quantity: 0 }),
    );
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.action).toBe("remove");
      expect(intent.lines[0]?.quantity).toBe(0);
    }
  });

  it("accepts 1-based `line` index as a fallback", () => {
    const result = parseCartRequest("/cart/change.js", JSON.stringify({ line: 2, quantity: 5 }));
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.lines[0]?.id).toBe("2");
    }
  });

  it("returns empty intents when both id and line are missing", () => {
    const result = parseCartRequest("/cart/change.js", JSON.stringify({ quantity: 1 }));
    expect(result?.intents).toHaveLength(0);
  });
});

describe("parseCartRequest — /cart/update.js", () => {
  it("emits a single lines-update for an `updates` map", () => {
    const result = parseCartRequest(
      "/cart/update.js",
      JSON.stringify({ updates: { "12345": 3, "67890": 0 } }),
    );
    expect(result?.intents).toHaveLength(1);
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.action).toBe("update");
      expect(intent.lines).toEqual([
        { merchandiseId: "gid://shopify/ProductVariant/12345", quantity: 3 },
        { merchandiseId: "gid://shopify/ProductVariant/67890", quantity: 0 },
      ]);
    }
  });

  it("emits a note-update when `note` is present", () => {
    const result = parseCartRequest("/cart/update.js", JSON.stringify({ note: "gift-wrap" }));
    expect(result?.intents).toHaveLength(1);
    const intent = result?.intents[0];
    expect(intent?.kind).toBe("note");
    if (intent?.kind === "note") {
      expect(intent.note).toBe("gift-wrap");
    }
  });

  it("emits a discount-update when `discount` is present", () => {
    const result = parseCartRequest("/cart/update.js", JSON.stringify({ discount: "SUMMER10" }));
    expect(result?.intents).toHaveLength(1);
    const intent = result?.intents[0];
    if (intent?.kind === "discount") {
      expect(intent.discountCodes).toEqual([{ code: "SUMMER10" }]);
    }
  });

  it("emits a discount clear when `discount` is an empty string", () => {
    const result = parseCartRequest("/cart/update.js", JSON.stringify({ discount: "" }));
    const intent = result?.intents[0];
    if (intent?.kind === "discount") {
      expect(intent.discountCodes).toEqual([]);
    }
  });

  it("emits MULTIPLE intents when a single request changes lines + note + discount", () => {
    const body = JSON.stringify({
      updates: { "11": 1 },
      note: "hello",
      discount: "CODE10",
    });
    const result = parseCartRequest("/cart/update.js", body);
    expect(result?.intents).toHaveLength(3);
    const kinds = result?.intents.map((i) => i.kind);
    expect(kinds).toContain("lines");
    expect(kinds).toContain("note");
    expect(kinds).toContain("discount");
  });

  it("returns empty intents when body has only unrelated fields", () => {
    const result = parseCartRequest("/cart/update.js", JSON.stringify({ irrelevant: true }));
    expect(result?.intents).toHaveLength(0);
  });
});

describe("parseCartRequest — /cart/clear.js", () => {
  it("emits a single lines-remove intent with empty lines", () => {
    const result = parseCartRequest("/cart/clear.js", undefined);
    expect(result?.intents).toHaveLength(1);
    const intent = result?.intents[0];
    if (intent?.kind === "lines") {
      expect(intent.action).toBe("remove");
      expect(intent.lines).toEqual([]);
    }
  });
});

describe("parseCartRequest — non-matching URLs", () => {
  it("returns null for non-cart URLs", () => {
    expect(parseCartRequest("/products/foo.js", undefined)).toBeNull();
    expect(parseCartRequest("/cart.js", undefined)).toBeNull();
  });
});

describe("parseCartRequest — /cart/update.js with `updates` array form", () => {
  // The Liquid `<input name="updates[]">` form encodes updates positionally
  // (no variant IDs, just quantities indexed by cart-line position). This is
  // the legacy Liquid form pattern still used by themes that submit a
  // <form action="/cart/update"> rather than a JSON fetch. parseUpdateBody
  // must handle both the keyed-object form (modern AJAX) AND the positional
  // array form, otherwise the line-update intents from these themes are
  // silently dropped.
  it("parses positional updates array into per-line update intents", () => {
    const parsed = parseCartRequest("/cart/update.js", JSON.stringify({ updates: [3, 0, 2] }));
    expect(parsed).not.toBeNull();
    const intent = parsed?.intents[0];
    expect(intent?.kind).toBe("lines");
    if (intent?.kind === "lines") {
      expect(intent.action).toBe("update");
      expect(intent.lines).toEqual([
        { id: "line:1", quantity: 3 },
        { id: "line:2", quantity: 0 },
        { id: "line:3", quantity: 2 },
      ]);
    }
  });

  it("drops non-numeric entries from positional updates array", () => {
    const parsed = parseCartRequest(
      "/cart/update.js",
      JSON.stringify({ updates: [1, "not-a-number", 2] }),
    );
    expect(parsed?.intents[0]).toMatchObject({
      kind: "lines",
      lines: [
        { id: "line:1", quantity: 1 },
        // line:2 dropped — quantity "not-a-number" coerces to null
        { id: "line:3", quantity: 2 },
      ],
    });
  });

  it("emits no lines intent when every positional update is non-numeric", () => {
    const parsed = parseCartRequest("/cart/update.js", JSON.stringify({ updates: ["a", "b"] }));
    // Body parsed successfully but yielded no usable intents.
    expect(parsed?.intents.filter((i) => i.kind === "lines")).toEqual([]);
  });
});

describe("parseCartRequest — body parsing fallback", () => {
  // The form-urlencoded fallback path in parseBody (cart-request.ts ~165) is
  // exercised whenever the body isn't JSON — most often the theme's classic
  // <form action="/cart/add"> shape. We also defensively wrap the
  // URLSearchParams construction in try/catch because some environments
  // throw on invalid surrogate sequences. The catch returns null so the
  // request passes through untouched.
  it("returns no intents for an empty body", () => {
    // Empty body → parseBody returns null → no intents extracted.
    expect(parseCartRequest("/cart/add.js", "")?.intents ?? []).toEqual([]);
    expect(parseCartRequest("/cart/add.js", undefined)?.intents ?? []).toEqual([]);
  });

  it("returns no intents when form-urlencoded body has no recognized keys", () => {
    // Body parses successfully (URLSearchParams accepts arbitrary key/value
    // pairs) but contains no id / quantity / updates / note / discount —
    // so no intents are emitted. Exercises the empty-intents tail of the
    // urlencoded fallback path.
    const parsed = parseCartRequest("/cart/add.js", "irrelevant=value&also=this");
    expect(parsed?.intents ?? []).toEqual([]);
  });
});
