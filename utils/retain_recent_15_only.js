import { readdir, stat, unlink } from "fs/promises";
import path from "path";


const FOLDER_PATH = path.resolve(process.cwd(), "backups-for-json-l");
const MAX_FILES = 25;

export async function retainRecent15FilesOnly() {
  try {
    const files = await readdir(FOLDER_PATH);

    const filesWithStats = await Promise.all(
      files.map(async (file) => {
        const fullPath = path.join(FOLDER_PATH, file);
        const stats = await stat(fullPath);

        return {
          file,
          fullPath,
          mtime: stats.mtime,
          isFile: stats.isFile(),
        };
      })
    );

    const onlyFiles = filesWithStats.filter(f => f.isFile);

    // newest first
    onlyFiles.sort((a, b) => b.mtime - a.mtime);

    const filesToDelete = onlyFiles.slice(MAX_FILES);

    for (const file of filesToDelete) {
      await unlink(file.fullPath);
      console.log(`Deleted: ${file.file}`);
    }

    console.log(`Done. Retained ${Math.min(onlyFiles.length, MAX_FILES)} files.`);
  } catch (err) {
    console.error("Error:", err);
  }
}