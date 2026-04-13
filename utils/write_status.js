import fs from "fs/promises";

export async function writeStatus(status, message, sub_operation) {
  try {
    await fs.writeFile(
      "status.json",
      JSON.stringify(
        {
          status,
          message,
          sub_operation
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch (err) {
    console.error("Failed to write status:", err);
    throw err;
  }
}

export async function writeStatusforPartialSKU(status, message, sub_operation) {
  try {
    await fs.writeFile(
      "status-partial-sku.json",
      JSON.stringify(
        {
          status,
          message,
          sub_operation
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch (err) {
    console.error("Failed to write status:", err);
    throw err;
  }
}