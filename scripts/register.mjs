// scripts/register.mjs  (used with:  node --import ./scripts/register.mjs ...)
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
