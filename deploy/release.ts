// bun run release [patch|minor|major|1.2.3]: checks, bumps package.json, commits, tags and pushes.
// The tag starts the Release workflow, which publishes the image and the release notes on GitHub.
import { $ } from "bun";

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

const request = process.argv[2] ?? "patch";
const branch = (await $`git branch --show-current`.text()).trim();

if (branch !== "main") fail(`releases leave from main, and this is ${branch || "a detached HEAD"}.`);
if ((await $`git status --porcelain`.text()).trim()) fail("there are uncommitted changes. Commit or stash them first.");

const file = Bun.file("package.json");
const pkg: { version: string } = await file.json();
const [major = 0, minor = 0, patch = 0] = pkg.version.split(".").map(Number);

const next =
  request === "major"
    ? `${major + 1}.0.0`
    : request === "minor"
      ? `${major}.${minor + 1}.0`
      : request === "patch"
        ? `${major}.${minor}.${patch + 1}`
        : /^\d+\.\d+\.\d+$/.test(request)
          ? request
          : fail(`use patch, minor, major or a version like 1.2.3 (got ${request}).`);

const tag = `v${next}`;

if ((await $`git tag --list ${tag}`.text()).trim()) fail(`${tag} already exists.`);

await $`bun run check`;
await Bun.write(file, (await file.text()).replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
await $`git commit --all --message ${`Release ${tag}`}`;
await $`git tag ${tag}`;
await $`git push origin main ${tag}`;

console.log(`${tag} sent. GitHub is publishing the image and the release: see the Actions tab.`);
