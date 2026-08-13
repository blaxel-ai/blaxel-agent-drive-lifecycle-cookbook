import { rmSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "dist");
rmSync(outputDirectory, { recursive: true, force: true });
console.log("Removed generated dist output.");
