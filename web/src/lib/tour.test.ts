import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config, Driver } from "driver.js";

const driverMocks = vi.hoisted(() => {
  const instance = { drive: vi.fn(), destroy: vi.fn() };
  return {
    instance,
    calls: [] as Config[],
    create: vi.fn((config: Config) => {
      driverMocks.calls.push(config);
      return instance as unknown as Driver;
    }),
  };
});

vi.mock("driver.js", () => ({ driver: driverMocks.create }));

import { getTourStage, setTourStage, startOnboardTour } from "@/lib/tour";

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  driverMocks.calls.length = 0;
  driverMocks.create.mockClear();
  driverMocks.instance.drive.mockClear();
  driverMocks.instance.destroy.mockClear();
});

describe("tour stages", () => {
  it("stores the stage independently for each user", () => {
    setTourStage("user-a", "onboard");
    setTourStage("user-b", "studio");

    expect(getTourStage("user-a")).toBe("onboard");
    expect(getTourStage("user-b")).toBe("studio");
    expect(getTourStage("user-c")).toBeNull();
  });

  it("filters tour steps whose target elements are missing", () => {
    document.body.innerHTML = `
      <textarea data-tour="ratecard"></textarea>
      <button data-tour="structure">Structure with AI</button>
    `;

    startOnboardTour(vi.fn());

    const config = driverMocks.calls[0]!;
    expect(config.steps).toHaveLength(3);
    expect(config.steps?.[0]).not.toHaveProperty("element");
    expect(config.steps?.[0]?.popover?.showButtons).toEqual(["next", "close"]);
    expect(config.steps?.map((step) => step.element)).toEqual([
      undefined,
      '[data-tour="ratecard"]',
      '[data-tour="structure"]',
    ]);
    expect(config.progressText).toBe("{{current}} of {{total}}");
    expect(driverMocks.instance.drive).toHaveBeenCalledOnce();
  });
});
