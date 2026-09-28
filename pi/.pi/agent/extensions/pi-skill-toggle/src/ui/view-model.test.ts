import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SkillRecord } from "../types.ts";
import { defaultDesiredMode } from "./view-model.ts";

describe("defaultDesiredMode", () => {
  it("makes editable skills manual-only by default", () => {
    assert.equal(defaultDesiredMode(skillRecord("create-pr", "agent-invocable")), "manual-only");
  });

  it("keeps unslop agent-invocable by default", () => {
    assert.equal(defaultDesiredMode(skillRecord("unslop", "manual-only")), "agent-invocable");
  });

  it("preserves read-only skills because the dialog cannot apply changes to them", () => {
    assert.equal(defaultDesiredMode(skillRecord("external", "agent-invocable", false)), "agent-invocable");
  });
});

function skillRecord(name: string, mode: SkillRecord["mode"], editable = true): SkillRecord {
  return {
    id: `/skills/${name}/SKILL.md`,
    name,
    description: `${name} skill`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    source: { kind: "global", root: "/skills" },
    editable,
    mode,
    diagnostics: [],
  };
}
