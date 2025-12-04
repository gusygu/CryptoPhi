import { describe, expect, it } from "vitest";
import {
  normalizeSnapshotScope,
  SNAPSHOT_SCOPE_DEFAULT,
  type SnapshotScope,
} from "./service";

describe("normalizeSnapshotScope", () => {
  it("returns null when no valid entries are provided", () => {
    expect(normalizeSnapshotScope(null)).toBeNull();
    expect(normalizeSnapshotScope(undefined)).toBeNull();
    expect(normalizeSnapshotScope([1, 2, 3])).toBeNull();
  });

  it("filters invalid entries and deduplicates", () => {
    const input = ["settings", "SETTINGS", "market", "unknown"];
    const result = normalizeSnapshotScope(input);
    expect(result).toEqual(["settings", "market"]);
  });

  it("preserves order of the first valid appearance", () => {
    const valid: SnapshotScope[] = [
      "wallet",
      "ops",
      "matrices",
    ];
    const result = normalizeSnapshotScope(valid);
    expect(result).toEqual(valid);
  });

  it("handles mixed content gracefully", () => {
    const input = ["  str_aux ", null, "MEA_DYNAMICS", "oops"] as any[];
    const result = normalizeSnapshotScope(input);
    expect(result).toEqual(["str_aux", "mea_dynamics"]);
  });

  it("allows selecting every supported scope", () => {
    const result = normalizeSnapshotScope([...SNAPSHOT_SCOPE_DEFAULT]);
    expect(result).toEqual([...SNAPSHOT_SCOPE_DEFAULT]);
  });
});
