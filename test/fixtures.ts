import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "fixtures");

export function fixture(name: string): string {
  return readFileSync(path.join(root, name), "utf8");
}
