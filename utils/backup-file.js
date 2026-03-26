import fs from "fs";
import path from "path";

export function backupCurrentProductsData(backupFolderName, filePath) {
  try {
    const backupDir = path.join(process.cwd(), backupFolderName);

    // Ensure backup folder exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // If file exists → move to backup
    if (fs.existsSync(filePath)) {
      const now = new Date();

      const timestamp = now
        .toISOString()
        .replace(/[:.]/g, "-"); // safe filename

      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);

      const backupFileName = `${baseName}_${timestamp}${ext}`;
      const backupPath = path.join(backupDir, backupFileName);

      fs.renameSync(filePath, backupPath);

      console.log(`Backup created: ${backupFileName}`);
    }
  } catch (err) {
    console.error("Backup failed:", err);
    throw err;
  }
}