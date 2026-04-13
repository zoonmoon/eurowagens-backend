import fs from "fs";
import readline from "readline";

export async function convertLogsToCSV(
  inputFile = "update-logs.txt",
  outputFile = "output.csv"
) {
  const fileStream = fs.createReadStream(inputFile);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const writeStream = fs.createWriteStream(outputFile);

  const headers = [
    "date",
    "id",
    "haveTagsChanged",
    "hasDescriptionChanged",
    "oldDescriptionHtml",
    "newDescriptionHtml",
    "oldTags",
    "newTags",
  ];

  // ✅ write headers
  writeStream.write(headers.join(",") + "\n");

  let processed = 0;
  let skipped = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const item = JSON.parse(line);

      const row = {
        date: item.date || "",
        id: item.id || "",
        haveTagsChanged: item.hasTagsChanged ?? "",
        hasDescriptionChanged: item.hasDescriptionChanged ?? "",
        oldDescriptionHtml: item.oldDescriptionHtml || "",
        newDescriptionHtml: item.newDescriptionHtml || "",
        oldTags: Array.isArray(item.originalTags)
          ? item.originalTags.join(",")
          : "",
        newTags: Array.isArray(item.newTags)
          ? item.newTags.join(",")
          : "",
      };

      const csvRow =
        headers
          .map((h) => `"${row[h].toString().replace(/"/g, '""')}"`)
          .join(",") + "\n";

      // ✅ handle backpressure (important for huge files)
      if (!writeStream.write(csvRow)) {
        await new Promise((resolve) =>
          writeStream.once("drain", resolve)
        );
      }

      processed++;

      // ✅ optional progress log every 10k
      if (processed % 10000 === 0) {
        console.log(`Processed: ${processed}`);
      }

    } catch (err) {
      skipped++;
      console.error("Skipping invalid line");
    }
  }

  // ✅ properly close stream
  await new Promise((resolve) => writeStream.end(resolve));

  console.log("CSV generated:", outputFile);
  console.log(`Total processed: ${processed}`);
  console.log(`Total skipped: ${skipped}`);
}