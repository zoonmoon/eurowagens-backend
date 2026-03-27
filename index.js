import 'dotenv/config';
import http from "http";
import fs from "fs/promises";

import { initiateBulkOperationOK } from "./initiate_bulk_operation.js";
import { initiateInsertData } from "./insert_bulk_data_to_file.js";
import { validateAndCorrectTags } from "./utils/validate_and_correct_tags.js";
import { writeStatus } from './utils/write_status.js';

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

  if (method === "GET" && url === "/") {
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
});