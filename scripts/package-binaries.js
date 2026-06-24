// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compile the built server (dist/index.js) into self-contained executables
// with `bun build --compile`. Cross-compiles all targets from one host.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const entry = join(root, "dist", "index.js");
const outDir = join(root, "dist", "bin");

// `-baseline` avoids AVX2 SIGILL crashes on older / virtualized CPUs.
const TARGETS = [
  { target: "bun-linux-x64-baseline", outfile: "azure-devops-mcp-linux-x64" },
  { target: "bun-windows-x64", outfile: "azure-devops-mcp-windows-x64.exe" },
];

mkdirSync(outDir, { recursive: true });

for (const { target, outfile } of TARGETS) {
  const out = join(outDir, outfile);
  console.error(`Compiling ${target} -> ${out}`);
  const result = spawnSync("bun", ["build", "--compile", `--target=${target}`, entry, "--outfile", out], { stdio: "inherit" });
  if (result.error) {
    console.error(`bun not found or failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`bun build failed for ${target} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

// On NixOS, dynamically-linked Linux binaries need their ELF interpreter
// patched to the Nix store path so they can run on the build host. We derive
// the correct interpreter from the current Node process (which already runs).
// patchelf is available in the dev shell; skip silently on other platforms.
if (existsSync("/etc/NIXOS") && process.platform === "linux") {
  const linuxBin = join(outDir, "azure-devops-mcp-linux-x64");
  const patchelf = spawnSync("patchelf", ["--print-interpreter", linuxBin], { encoding: "utf8" });
  if (patchelf.error) {
    console.error("patchelf not found — skipping ELF interpreter patch (binary may not run on this host)");
  } else {
    const currentInterp = patchelf.stdout.trim();
    // Borrow the interpreter from the Node executable: it's correct for this Nix env.
    const nodeInterp = spawnSync("patchelf", ["--print-interpreter", process.execPath], { encoding: "utf8" });
    const nixInterp = nodeInterp.stdout.trim();
    if (nixInterp && currentInterp !== nixInterp && existsSync(nixInterp)) {
      console.error(`NixOS: patching ELF interpreter ${currentInterp} -> ${nixInterp}`);
      const patch = spawnSync("patchelf", ["--set-interpreter", nixInterp, linuxBin], { stdio: "inherit" });
      if (patch.status !== 0) {
        console.error("patchelf --set-interpreter failed");
        process.exit(patch.status ?? 1);
      }
    }
  }
}

console.error("All binaries built in dist/bin/");
