import { promises as fs } from "node:fs";
import path from "node:path";
import AdmZip, { IZipEntry } from "adm-zip";
import { QxfParseResult } from "@lightbridgedmx/shared";
import { parseQxf } from "./qxf";

const ZIP_URL = "https://codeload.github.com/mcallegari/qlcplus/zip/refs/heads/master";
const ZIP_PREFIX = "qlcplus-master/resources/fixtures/";
const LIB_ROOT = path.resolve(process.cwd(), "backend/data/fixtures");

export const ensureFixtureLibrary = async (opts?: { force?: boolean }) => {
  const exists = await hasAnyFixture();
  if (exists && !opts?.force) return;
  await downloadAndExtract();
};

export const listFixtureLibrary = async (): Promise<Array<{ path: string; data: QxfParseResult }>> => {
  await ensureFixtureLibrary();
  const files = await walkFiles(LIB_ROOT);
  const results: Array<{ path: string; data: QxfParseResult }> = [];

  for (const rel of files) {
    try {
      const xml = await fs.readFile(path.join(LIB_ROOT, rel), "utf8");
      const parsed = parseQxf(xml);
      results.push({ path: rel, data: parsed });
    } catch {
      // Ignore malformed files to keep the list responsive.
      continue;
    }
  }
  return results;
};

export const readFixtureFromLibrary = async (relativePath: string): Promise<string> => {
  await ensureFixtureLibrary();
  const target = path.join(LIB_ROOT, relativePath);
  return fs.readFile(target, "utf8");
};

const downloadAndExtract = async () => {
  await fs.rm(LIB_ROOT, { recursive: true, force: true });
  await fs.mkdir(LIB_ROOT, { recursive: true });

  const res = await fetch(ZIP_URL);
  if (!res.ok) {
    throw new Error(`Failed to download fixture library (HTTP ${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter(
      (entry: IZipEntry) =>
        !entry.isDirectory && entry.entryName.startsWith(ZIP_PREFIX) && entry.entryName.endsWith(".qxf")
    );

  for (const entry of entries) {
    const relative = entry.entryName.slice(ZIP_PREFIX.length);
    const target = path.join(LIB_ROOT, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const data = entry.getData();
    await fs.writeFile(target, data);
  }
};

const walkFiles = async (root: string, prefix = ""): Promise<string[]> => {
  let entries: string[] = [];
  let dirents;
  try {
    dirents = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }

  for (const dirent of dirents) {
    const rel = path.join(prefix, dirent.name);
    if (dirent.isDirectory()) {
      entries = entries.concat(await walkFiles(root, rel));
    } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith(".qxf")) {
      entries.push(rel);
    }
  }

  return entries;
};

const hasAnyFixture = async (): Promise<boolean> => {
  const files = await walkFiles(LIB_ROOT);
  return files.length > 0;
};
