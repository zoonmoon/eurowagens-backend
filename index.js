import 'dotenv/config';
import http from "http";
import fs from "fs/promises";
import { parse } from "url";
import cron from "node-cron";
import { initiateBulkOperationOK } from "./initiate_bulk_operation.js";
import { initiateInsertData } from "./insert_bulk_data_to_file.js";
import { validateAndCorrectTags } from "./utils/validate_and_correct_tags.js";
import { writeStatus } from './utils/write_status.js';
import { getRecentTagCorrections } from './utils/retrieve_recent_tag_corrrections.js';
import { convertTagJsonsToCSV } from './utils/convert_to_csv.js';
import path from "path";

async function isJobRunning() {
  try {
    const data = JSON.parse(await fs.readFile("status.json", "utf-8"));
    return data.status === "running";
  } catch {
    return false;
  }
}

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// 🔥 fire-and-forget with failure handling
function fireAndForget(url, failMessage, sub_operation) {
  fetch(url).catch(async (err) => {
    console.error("Async error:", err);
    await writeStatus("failed", failMessage, sub_operation);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const parsedUrl = parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (method === "GET" && pathname.includes("download-tag-correction-log")) {
    try {
      const { dirName, file_name } = parsedUrl.query;

      if (!dirName || !file_name) {
        res.writeHead(400);
        res.end("dirName and file_name are required");
        return;
      }

      const outputFile = `temp.csv`;

      // ✅ use your existing function
      await convertTagJsonsToCSV(dirName, outputFile, file_name);

      const filePath = path.resolve(outputFile);

      const file = await fs.readFile(filePath);

      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${file_name.replace(".json", ".csv")}"`
      });

      res.end(file);

      // ✅ cleanup temp file (optional but good)
      await fs.unlink(filePath);

    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end("CSV generation failed");
    }

    return;
  }



  if (method === "GET" && pathname === "/") {
    try {
      const html = await fs.readFile("./public/index.html", "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end("Failed to load UI");
    }
    return;
  }

  if (method === "GET" && pathname.includes('recent-tag-corrections-list')) {
    try {
      
      var dirName = "backups-for-invalid-products"

      const dirPath = path.resolve(dirName);
      const files = await getRecentTagCorrections(dirPath);

      res.writeHead(200, { "Content-Type": "application/json" });
      
      res.end(JSON.stringify(files));

    } catch (err) {
      res.writeHead(500);
        console.error("ERROR:", err); // 🔥 ADD THIS

      res.end("Failed to load data");
    }
    return;
  }


  // ---- GET /status ----
  if (method === "GET" && url === "/status") {
    try {
      const data = await fs.readFile("status.json", "utf-8");
      return sendJson(res, 200, JSON.parse(data));
    } catch {
      return sendJson(res, 200, {
        status: "idle",
        message: "Ready",
        sub_operation: null
      });
    }
  }

  // ---- GET /results ----
  if (method === "GET" && url === "/results") {
    try {
      const data = await fs.readFile("most_recent_invalid_products.json", "utf-8");
      return sendJson(res, 200, JSON.parse(data));
    } catch {
      return sendJson(res, 200, []);
    }
  }

  // ---- GET /initiate-bulk-operation ----
  if (method === "GET" && url === "/initiate-bulk-operation") {

    try {

      if (await isJobRunning()) {
        console.log("Skipping: job already running");

        return sendJson(res, 200, {
          message: "Job already running, skipped"
        });
      }

      await fs.writeFile(
        "started_at.json",
        JSON.stringify({ startedAt: new Date().toISOString() }, null, 2)
      );

      await writeStatus(
        "running",
        "Retrieving all products...",
        "initiate-bulk-operation"
      );

      await initiateBulkOperationOK();

      return sendJson(res, 200, { message: "Bulk operation initiated successfully" });

    } catch (err) {
      console.error(err);
      await writeStatus(
        "failed",
        "Failed to initiate bulk operation",
        "initiate-bulk-operation"
      );
      return sendJson(res, 500, { error: "Failed to initiate bulk operation" });
    }
  }

  // ---- POST /webhook ----
  if (method === "POST" && url === "/listen-to-bulk-op-completion-webhook") {
    try {
      await writeStatus(
        "running",
        "Products retrieved. Saving them in file...",
        "webhook-received"
      );

      res.writeHead(200);
      res.end("Webhook received");

      fireAndForget(
        process.env.SERVER_BASE_URL + "/start-saving-to-file",
        "Failed while saving products to file",
        "start-saving-to-file"
      );

    } catch (err) {
      console.error(err);
      await writeStatus(
        "failed",
        "Webhook handling failed",
        "webhook"
      );
    }
    return;
  }

  // ---- GET /start-saving-to-file ----
  if (method === "GET" && url === "/start-saving-to-file") {
    try {
      await writeStatus(
        "running",
        "Saving products to file...",
        "start-saving-to-file"
      );

      await initiateInsertData();

      fireAndForget(
        process.env.SERVER_BASE_URL + "/validate-and-correct-tags",
        "Failed while validating tags",
        "validate-and-correct-tags"
      );

      return sendJson(res, 200, { message: "Data inserted into file" });

    } catch (err) {
      console.error(err);
      await writeStatus(
        "failed",
        "Failed to save products to file",
        "start-saving-to-file"
      );
      return sendJson(res, 500, { error: "Insert failed" });
    }
  }

  // ---- GET /validate-and-correct-tags ----
  if (method === "GET" && url === "/validate-and-correct-tags") {
    try {
      await writeStatus(
        "running",
        "Fixing tag inconsistencies...",
        "validate-and-correct-tags"
      );

      await validateAndCorrectTags();

      await writeStatus(
        "completed",
        "Products scanned and tag inconsistencies resolved.",
        "completed"
      );

      return sendJson(res, 200, { message: "Validated and corrected tags" });

    } catch (err) {
      console.error(err);
      await writeStatus(
        "failed",
        "Tag validation failed",
        "validate-and-correct-tags"
      );
      return sendJson(res, 500, { error: "Validation failed" });
    }
  }

  // ---- 404 ----
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const PORT = 3000;



server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);

  // ⏰ Cron starts AFTER server is up
  cron.schedule("0 * * * *", async () => {
    console.log("Cron triggered...");

    if (await isJobRunning()) {
      console.log("Skipping: job already running");
      return;
    }

    console.log("Running bulk operation every hour...");

    try {
      await fetch(process.env.SERVER_BASE_URL + "/initiate-bulk-operation");
    } catch (err) {
      console.error("Cron failed:", err);
    }
  });






});