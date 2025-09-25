import "dotenv/config";
import { uploadFile } from "./lib/cloudflare";
import path from "path";
import fs from "fs/promises";
import { updateAdvertisementById } from "./repository/advertisement";

/**
 * Recursively list all files under assets/videos (or a custom dir).
 *
 * @param {string} [baseDir=path.resolve(process.cwd(), "assets", "videos")]
 * @param {{ relative?: boolean }} [opts]
 *   - relative: return paths relative to baseDir (default true). If false, return absolute paths.
 * @returns {Promise<string[]>}
 */
export async function listAllFiles(
  baseDir: string = path.resolve(process.cwd(), "src", "assets", "videos"),
  options?: { relative: boolean }
) {
  const { relative = true } = options || {};
  const out: string[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err && err.code === "ENOENT") return; // folder doesn't exist → just return empty
      throw err;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(relative ? path.relative(baseDir, full) : full);
      } else if (entry.isSymbolicLink()) {
        // Follow symlinks defensively
        try {
          const stat = await fs.stat(full);
          if (stat.isDirectory()) await walk(full);
          else if (stat.isFile())
            out.push(relative ? path.relative(baseDir, full) : full);
        } catch {
          /* ignore broken symlink */
        }
      }
    }
  }

  console.log(baseDir);
  await walk(baseDir);
  out.sort(); // stable order
  return out;
}

// uploadFile(
//   path.join(
//     __dirname,
//     "assets/videos/3f026acd-6c49-485e-a4bf-45efa08bb2f1.mp4"
//   ),
//   "3f026acd-6c49-485e-a4bf-45efa08bb2f1.mp4"
// ).catch(console.error);

async function main() {
  const files = await listAllFiles(
    path.resolve(process.cwd(), "src", "assets", "videos"),
    { relative: false }
  );
  // console.log(`Found ${files.length} file(s) to upload.`, files);

  for (const filePath of files) {
    const basename = path.basename(filePath);
    const fileUrl = await uploadFile(filePath, basename);
    console.log(`Uploaded ${filePath} to ${fileUrl}`);
    const id = basename.replace(/\.mp4$/i, "");
    await updateAdvertisementById(id, { video_url: fileUrl });
  }
}

main();
