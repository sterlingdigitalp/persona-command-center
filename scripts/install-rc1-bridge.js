#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const source = path.join(rootDir, "external_bridge", "watch_list_processor.py");
const target = process.env.HERMES_WATCHLIST_PROCESSOR
  || "/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py";

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`Installed RC-1 hardened bridge:\n${source}\n-> ${target}`);
