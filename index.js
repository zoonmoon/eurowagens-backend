import 'dotenv/config';
import http from "http";
import { initiateBulkOperationOK } from "./initiate_bulk_operation.js";

import {initiateInsertData} from "./insert_bulk_data_to_file.js"

import {validateAndCorrectTags} from "./utils/validate_and_correct_tags.js"

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // /initiate-bulk-operation


  // ---- GET /initiate-bulk-operation ----
  if (method === "GET" && url === "/initiate-bulk-operation") {
    try {
      await initiateBulkOperationOK();
      sendJson(res, 200, { message: "Bulk operation initiated successfully" });
    } catch (err) {
      console.error("Error initiating bulk operation:", err);
      sendJson(res, 500, { error: "Failed to initiate bulk operation" });
    }
    return;
  }

  // ---- POST /listen-to-bulk-op-completion-webhook ----
  if (method === "POST" && url === "/listen-to-bulk-op-completion-webhook") {
    // Respond immediately to acknowledge webhook
    res.writeHead(200);
    res.end("Webhook received");
    fetch(process.env.SERVER_BASE_URL + "/start-saving-to-file");
    // Trigger next process asynchronously
    return;
  }

  // ---- GET /start-saving-to-opensearch ----
  if (method === "GET" && url === "/start-saving-to-file") {
    try {
      await initiateInsertData();
      fetch(process.env.SERVER_BASE_URL + "/validate-and-correct-tags");
      sendJson(res, 200, { message: "Data inserted into file" });
    } catch (err) {
      console.error("Error inserting data:", err);
      sendJson(res, 500, { error: "Failed to insert data into OpenSearch" });
    }
    return;
  }

  // ---- GET /start-saving-to-opensearch ----
  if (method === "GET" && url === "/validate-and-correct-tags") {
    try {
      await validateAndCorrectTags()
      sendJson(res, 200, { message: "Validated and corrected tags" });
    } catch (err) {
      console.error("Error inserting data:", err);
      sendJson(res, 500, { error: "Failed to insert data into OpenSearch" });
    }
    return;
  }




  // ---- Fallback for unknown routes ----
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
