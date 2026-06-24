import { afterEach, describe, expect, it, vi } from "vitest";

import { installLifecycleWatchers } from "../src/lifecycle.js";

import { buildMockStandardEventsModule } from "./helpers/fixtures.js";

afterEach(() => {
  delete (window as { Shopify?: unknown }).Shopify;
});

describe("installLifecycleWatchers", () => {
  it("calls onCapabilityAppeared when native library appears on visibilitychange", () => {
    const onCapabilityAppeared = vi.fn();
    const uninstall = installLifecycleWatchers(window, { onCapabilityAppeared });

    // Initially no native support — should not fire.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onCapabilityAppeared).not.toHaveBeenCalled();

    // Native library appears, then visibility flips → fire once.
    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onCapabilityAppeared).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it("fires on pageshow when capability appears", () => {
    const onCapabilityAppeared = vi.fn();
    const uninstall = installLifecycleWatchers(window, { onCapabilityAppeared });

    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    window.dispatchEvent(new Event("pageshow"));
    expect(onCapabilityAppeared).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it("only fires onCapabilityAppeared once even if both events trigger", () => {
    const onCapabilityAppeared = vi.fn();
    const uninstall = installLifecycleWatchers(window, { onCapabilityAppeared });

    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onCapabilityAppeared).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it("uninstall removes listeners cleanly", () => {
    const onCapabilityAppeared = vi.fn();
    const uninstall = installLifecycleWatchers(window, { onCapabilityAppeared });
    uninstall();

    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));

    expect(onCapabilityAppeared).not.toHaveBeenCalled();
  });
});
