import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const check = spawnSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);

if (check.error || check.status !== 0) {
  console.error("Cannot verify Git status; refusing production deployment.");
  console.error(check.stderr?.trim() || check.error?.message || "Unknown Git error.");
  process.exit(1);
}

const changes = check.stdout.trimEnd();
if (changes) {
  const count = changes.split("\n").length;
  console.error(
    `Refusing production deployment: the Git worktree has ${count} uncommitted path${count === 1 ? "" : "s"}.`,
  );
  console.error(changes);
  console.error("Commit or intentionally remove these changes before releasing.");
  process.exit(1);
}

console.log("Release guard passed: Git worktree is clean.");
