import fs from "fs/promises";
import path from "path";

export async function convertTagJsonsToCSV(
  dirName,
  outputFile = "output.csv",
  targetFileName = null // optional
) {
  let files = [];
    const dirPath = path.resolve(dirName);

  // ✅ Decide files to process
  if (targetFileName) {
    files = [targetFileName];
  } else {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    files = dirents.filter(d => d.isFile()).map(d => d.name);
  }

  const rows = [];
  const tagKeysSet = new Set();

  for (const fileName of files) {
    const filePath = path.join(dirPath, fileName);

    try {
      const stat = await fs.stat(filePath);

      // ✅ Skip empty arrays
      if (stat.size <= 5) continue;

      const content = await fs.readFile(filePath, "utf-8");
      const json = JSON.parse(content);

      if (!Array.isArray(json)) continue;

      for (const item of json) {
        const row = { id: item.id };

        for (const key of Object.keys(item)) {
          if (key.toLowerCase().includes("tag")) {
            tagKeysSet.add(key);

            // ✅ Join tags with comma (CSV-safe)
            row[key] = Array.isArray(item[key])
              ? item[key].join(",")
              : item[key];
          }
        }

        rows.push(row);
      }

    } catch (err) {
      console.error("Skipping invalid file:", fileName);
    }
  }

  const headers = ["id", ...Array.from(tagKeysSet)];

  // ✅ Build CSV
  const csvLines = [
    headers.join(","),

    ...rows.map(row =>
      headers
        .map(h => {
          const value = (row[h] ?? "").toString();

          // escape quotes for CSV
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(",")
    )
  ];

  const csvContent = csvLines.join("\n");

  await fs.writeFile(outputFile, csvContent, "utf-8");

  console.log("CSV generated:", outputFile);
}