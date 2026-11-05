import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const out = mkdtempSync(join(tmpdir(), "opendieline-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

function cli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("cli", () => {
  it("lists templates", () => {
    const { status, stdout } = cli("list");
    expect(status).toBe(0);
    expect(stdout).toContain("reverse-tuck-end");
  });

  it("writes the requested formats and reports verification", () => {
    const { status, stdout } = cli(
      "generate", "sleeve", "-l", "100", "-w", "50", "-d", "150", "-f", "svg,json", "-o", out,
    );
    expect(status).toBe(0);
    expect(stdout).toContain("PASS  closure");
    expect(existsSync(join(out, "sleeve.svg"))).toBe(true);
    const report = JSON.parse(readFileSync(join(out, "sleeve.json"), "utf8"));
    expect(report.verification.passed).toBe(true);
    expect(report.parameters.length).toBe(100);
  });

  it.each([
    [["generate", "nope"], "Unknown template"],
    [["generate", "sleeve", "-l", "abc"], "must be a number"],
    [["generate", "sleeve", "--length=-5"], "length must be"],
    [["generate", "sleeve", "-f", "exe"], "Unknown format"],
    [["generate", "sleeve", "--nonsense"], "Error"],
  ])("exits 1 with a clear message for %j", (args, message) => {
    const { status, stderr } = cli(...args);
    expect(status).toBe(1);
    expect(stderr).toContain(message);
  });
});
