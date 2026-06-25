import { afterEach, describe, expect, it, vi } from "vitest";

import { installLifecycleWatchers } from "../src/lifecycle.js";

import { buildMockStandardEventsModule } from "./helpers/fixtures.js";

afterEach(() => {
  delete (window as { Shopify?: unknown }).Shopify;
});

// Helper — set Shopify global to a configuration that REPRESENTS the native
// support signal (theme has configured updateCart). Plain StandardEvents
// library presence is no longer sufficient — see capability.ts docblock.
function setNativeSupport(): void {
  window.Shopify = {
    StandardEvents: buildMockStandardEventsModule(),
    actions: {
      updateCart: Object.assign(() => Promise.resolve({}), { isDefault: () => false }),
    },
  };
}

describe("installLifecycleWatchers", () => {
  it("calls onCapabilityAppeared when native support appears on visibilitychange", () => {
    const onCapabilityAppeared = vi.fn();
    const uninstall = installLifecycleWatchers(window, { onCapabilityAppeared });

    // Initially no native support — should not fire.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onCapabilityAppeared).not.toHaveBeenCalled();

    // Native support appears (configured updateCart), then visibility flips → fire once.
    setNativeSupport();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onCapabilityAppeared).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it("fires on pageshow when capability appears", () => {
    const onCapabilityAppeared = vi.fn();
    const uninstall = installLifecycleWatchers(window, { onCapabilityAppeared });

    setNativeSupport();
    window.dispatchEvent(new Event("pageshow"));
    expect(onCapabilityAppeared).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it("only fires onCapabilityAppeared once even if both events trigger", () => {
    const onCapabilityAppeared = vi.fn();
    const uninstall = installLifecycleWatchers(window, { onCapabilityAppeared });

    setNativeSupport();
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

    setNativeSupport();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));

    expect(onCapabilityAppeared).not.toHaveBeenCalled();
  });
});
