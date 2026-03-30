import fs from "fs/promises";
import path from "path";

export async function getRecentTagCorrections(dirPath, limit = 100) {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });

  const filesWithStats = await Promise.all(
    dirents
      .filter(d => d.isFile())
      .map(async (file) => {
        const filePath = path.join(dirPath, file.name);
        const stat = await fs.stat(filePath);

        return {
          name: file.name,
          createdAt: stat.birthtime || stat.ctime,
          size: stat.size
        };
      })
  );

  // sort newest first
  filesWithStats.sort((a, b) => b.createdAt - a.createdAt);

  // take latest N
  const latestFiles = filesWithStats.slice(0, limit);

  // filter out empty arrays via size
  return latestFiles
    .filter(file => file.size > 5)
    .map(file => ({
      name: file.name,
      directory: "backups-for-invalid-products",
      createdAt: file.createdAt,
      size: file.size,
      download: `/tag-corrections-download/${encodeURIComponent(file.name)}`
    }));
}