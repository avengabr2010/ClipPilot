// Resolves Playwright from the project or from the globally pre-installed copy.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req("playwright");
  } catch {
    const root = execSync("npm root -g").toString().trim();
    return createRequire(`${root}/`)("playwright");
  }
}
