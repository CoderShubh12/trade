// scripts/loader.mjs
// Lets plain Node run the app's engine files (lib/*.js).
// The app writes imports like  import x from "./sessionUtils"  (no ".js"),
// which Next.js understands but plain Node does not. This adds the ".js".
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const projectRoot = path.resolve(import.meta.dirname, "..");

export async function resolve(specifier, context, nextResolve) {
  // "@/lib/x" alias used by the app -> project root
  if (specifier.startsWith("@/")) {
    specifier = pathToFileURL(path.join(projectRoot, specifier.slice(2))).href;
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isFileLike = specifier.startsWith(".") || specifier.startsWith("file:");
    if (isFileLike && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return await nextResolve(specifier + ".js", context);
      } catch {}
      try {
        return await nextResolve(specifier + "/index.js", context);
      } catch {}
    }
    throw err;
  }
}
