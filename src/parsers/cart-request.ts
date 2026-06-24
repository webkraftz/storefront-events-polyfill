/**
 * Request-body parsers for Shopify's AJAX cart endpoints. Each parser inspects
 * the request body (JSON or form-urlencoded), determines what changed, and
 * returns a structured intent describing which standard events should fire.
 *
 * Reference: https://shopify.dev/docs/api/ajax/reference/cart
 *
 *  - /cart/add.js     — { items: [{ id, quantity, properties? }] } or { id, quantity, properties? }
 *  - /cart/change.js  — { id | line, quantity, properties? }
 *  - /cart/update.js  — { updates: { variantId: qty }, attributes?, note?, discount? }
 *  - /cart/clear.js   — no body
 */

import { type CartLineAction, type CartLineUpdate } from "../types.js";

/** Discriminated cart mutation intent — what events should fire. */
export type CartMutationIntent =
  | { kind: "lines"; action: CartLineAction; lines: CartLineUpdate[] }
  | { kind: "note"; note: string }
  | { kind: "discount"; discountCodes: Array<{ code: string }> };

/** All intents extracted from one HTTP request. A single /cart/update.js call
 * can produce multiple intents (lines + note + discount in one POST). */
export interface ParsedCartRequest {
  endpoint: "add" | "change" | "update" | "clear";
  intents: CartMutationIntent[];
}

const CART_ENDPOINT_REGEX = /\/cart\/(add|change|update|clear)(?:\.js)?(?:\?|$)/;

/** Returns the cart endpoint name if the URL matches, else null. */
export function matchCartEndpoint(url: string): ParsedCartRequest["endpoint"] | null {
  const match = CART_ENDPOINT_REGEX.exec(url);
  if (!match) return null;
  const endpoint = match[1] as ParsedCartRequest["endpoint"];
  return endpoint;
}

/**
 * Parses a cart request and returns the set of mutation intents. Returns null
 * if the URL doesn't match a known cart endpoint. Throws on a malformed body
 * for a known endpoint — caller catches and dispatches a CartErrorEvent.
 */
export function parseCartRequest(url: string, body: string | undefined): ParsedCartRequest | null {
  const endpoint = matchCartEndpoint(url);
  if (!endpoint) return null;

  switch (endpoint) {
    case "add":
      return { endpoint, intents: parseAddBody(body) };
    case "change":
      return { endpoint, intents: parseChangeBody(body) };
    case "update":
      return { endpoint, intents: parseUpdateBody(body) };
    case "clear":
      return { endpoint, intents: parseClearBody() };
  }
}

function parseAddBody(rawBody: string | undefined): CartMutationIntent[] {
  const body = parseBody(rawBody);
  if (!body) return [];

  // /cart/add.js accepts either { items: [...] } or a single { id, quantity }.
  const items = Array.isArray(body["items"]) ? (body["items"] as unknown[]) : [body];
  const lines: CartLineUpdate[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    const id = readString(item, "id");
    const quantity = readNumber(item, "quantity") ?? 1;
    if (!id || quantity <= 0) continue;
    lines.push({ merchandiseId: toMerchandiseGid(id), quantity });
  }
  return lines.length > 0 ? [{ kind: "lines", action: "add", lines }] : [];
}

function parseChangeBody(rawBody: string | undefined): CartMutationIntent[] {
  const body = parseBody(rawBody);
  if (!body) return [];

  // /cart/change.js targets a single line — either by `id` (line key) or `line` (1-based index).
  const lineKey = readString(body, "id") ?? readNumberAsString(body, "line");
  const quantity = readNumber(body, "quantity");
  if (!lineKey || quantity === null) return [];

  const action: CartLineAction = quantity === 0 ? "remove" : "update";
  return [{ kind: "lines", action, lines: [{ id: lineKey, quantity }] }];
}

function parseUpdateBody(rawBody: string | undefined): CartMutationIntent[] {
  const body = parseBody(rawBody);
  if (!body) return [];

  const intents: CartMutationIntent[] = [];

  // `updates` can be a map (variantId -> quantity) or an array (positional quantities).
  const updates = body["updates"];
  if (isObject(updates)) {
    const lines: CartLineUpdate[] = [];
    for (const [variantOrKey, qtyRaw] of Object.entries(updates)) {
      const quantity = coerceNumber(qtyRaw);
      if (quantity === null) continue;
      // Heuristic: keys that look like Shopify line keys (UUID-ish strings) are
      // existing lines; numeric keys are variant ids → add intent.
      if (/^[0-9]+$/.test(variantOrKey)) {
        lines.push({ merchandiseId: toMerchandiseGid(variantOrKey), quantity });
      } else {
        lines.push({ id: variantOrKey, quantity });
      }
    }
    if (lines.length > 0) {
      // /cart/update.js with updates is conceptually an "update" — keep semantics consistent.
      intents.push({ kind: "lines", action: "update", lines });
    }
  } else if (Array.isArray(updates)) {
    const lines: CartLineUpdate[] = [];
    for (let idx = 0; idx < updates.length; idx += 1) {
      const quantity = coerceNumber(updates[idx]);
      if (quantity === null) continue;
      lines.push({ id: `line:${idx + 1}`, quantity });
    }
    if (lines.length > 0) {
      intents.push({ kind: "lines", action: "update", lines });
    }
  }

  if (typeof body["note"] === "string") {
    intents.push({ kind: "note", note: body["note"] });
  }

  // /cart/update.js exposes `discount` (single code apply) or `discount_code`
  // depending on theme convention. Both should map to CartDiscountUpdateEvent.
  const discountCode =
    (typeof body["discount"] === "string" ? body["discount"] : undefined) ??
    (typeof body["discount_code"] === "string" ? body["discount_code"] : undefined);
  if (discountCode !== undefined) {
    const trimmed = discountCode.trim();
    intents.push({
      kind: "discount",
      discountCodes: trimmed === "" ? [] : [{ code: trimmed }],
    });
  }

  return intents;
}

function parseClearBody(): CartMutationIntent[] {
  // Clear empties the cart. Represent as a single lines-update with action=remove
  // and an empty payload — listeners that care about the resulting cart state
  // will use event.promise to get the fresh cart.
  return [{ kind: "lines", action: "remove", lines: [] }];
}

function parseBody(raw: string | undefined): Record<string, unknown> | null {
  if (raw === undefined || raw === "") return null;
  // Try JSON first (modern themes use Content-Type: application/json).
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isObject(parsed)) return parsed;
  } catch {
    // Fall through to form-urlencoded parsing.
  }
  // Form-urlencoded fallback for themes that POST with classic form encoding.
  try {
    const params = new URLSearchParams(raw);
    const out: Record<string, unknown> = {};
    for (const [key, value] of params) {
      out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  return coerceNumber(obj[key]);
}

function readNumberAsString(obj: Record<string, unknown>, key: string): string | null {
  const num = coerceNumber(obj[key]);
  return num === null ? null : String(num);
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const SHOPIFY_VARIANT_GID_PREFIX = "gid://shopify/ProductVariant/";

function toMerchandiseGid(idOrGid: string): string {
  return idOrGid.startsWith(SHOPIFY_VARIANT_GID_PREFIX)
    ? idOrGid
    : `${SHOPIFY_VARIANT_GID_PREFIX}${idOrGid}`;
}
