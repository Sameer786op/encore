import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import yauzl from "yauzl";

// A data export arrives as a .zip (sometimes with zips inside), an unpacked
// folder, or a single file. We list what's inside without reading it all,
// then read only the files we know how to use.

export interface ExportFile {
  /** path inside the export, always with forward slashes */
  name: string;
  size: number;
  read(): Promise<Buffer>;
}

/** files we might read; anything else (videos, photos) is never opened */
const INTERESTING = /\.(json|csv|html?|zip)$/i;
const MAX_FILE_BYTES = 400 * 1024 * 1024;
const MAX_FILES = 20_000;

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

type ZipSource = { kind: "path"; path: string } | { kind: "buffer"; buffer: Buffer };

function openZip(source: ZipSource): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    const done = (err: Error | null, zip?: yauzl.ZipFile) => (err || !zip ? reject(err ?? new Error("Couldn't open the zip")) : resolve(zip));
    if (source.kind === "path") yauzl.open(source.path, { lazyEntries: true, autoClose: false }, done);
    else yauzl.fromBuffer(source.buffer, { lazyEntries: true, autoClose: false }, done);
  });
}

interface Listing {
  files: ExportFile[];
  zips: yauzl.ZipFile[];
}

async function listZip(source: ZipSource, prefix: string, depth: number, out: Listing): Promise<void> {
  const zip = await openZip(source);
  out.zips.push(zip);
  const entries: yauzl.Entry[] = await new Promise((resolve, reject) => {
    const found: yauzl.Entry[] = [];
    zip.on("entry", (entry: yauzl.Entry) => {
      if (!entry.fileName.endsWith("/") && INTERESTING.test(entry.fileName) && entry.uncompressedSize <= MAX_FILE_BYTES) found.push(entry);
      if (found.length < MAX_FILES) zip.readEntry();
      else resolve(found);
    });
    zip.on("end", () => resolve(found));
    zip.on("error", reject);
    zip.readEntry();
  });

  const read = (entry: yauzl.Entry) =>
    new Promise<Buffer>((resolve, reject) => {
      zip.openReadStream(entry, (err, stream) => (err || !stream ? reject(err) : streamToBuffer(stream).then(resolve, reject)));
    });

  for (const entry of entries) {
    const name = `${prefix}${entry.fileName}`;
    // exports often wrap the real data in another zip (Apple does this)
    if (/\.zip$/i.test(entry.fileName)) {
      if (depth < 2) await listZip({ kind: "buffer", buffer: await read(entry) }, `${name}/`, depth + 1, out);
      continue;
    }
    out.files.push({ name, size: entry.uncompressedSize, read: () => read(entry) });
  }
}

async function listFolder(root: string, folder: string, out: Listing, depth = 0): Promise<void> {
  if (depth > 8 || out.files.length >= MAX_FILES) return;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) await listFolder(root, full, out, depth + 1);
    else if (INTERESTING.test(entry.name)) {
      const size = (await stat(full)).size;
      if (size > MAX_FILE_BYTES) continue;
      const name = relative(root, full).replace(/\\/g, "/");
      if (/\.zip$/i.test(entry.name)) await listZip({ kind: "path", path: full }, `${name}/`, 1, out);
      else out.files.push({ name, size, read: () => readFile(full) });
    }
  }
}

/** list an export's files; call `close` when done reading */
export async function openExport(path: string): Promise<{ files: ExportFile[]; close(): void }> {
  const info = await stat(path);
  const out: Listing = { files: [], zips: [] };
  const close = () => out.zips.forEach((z) => z.close());
  try {
    if (info.isDirectory()) await listFolder(path, path, out);
    else if (extname(path).toLowerCase() === ".zip") await listZip({ kind: "path", path }, "", 0, out);
    else out.files.push({ name: basename(path), size: info.size, read: () => streamToBuffer(createReadStream(path)) });
  } catch (error) {
    close();
    throw error;
  }
  return { files: out.files, close };
}

export async function readText(file: ExportFile): Promise<string> {
  return (await file.read()).toString("utf8");
}

export async function readJson<T>(file: ExportFile): Promise<T | null> {
  try {
    const text = await readText(file);
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as T;
  } catch {
    return null;
  }
}
