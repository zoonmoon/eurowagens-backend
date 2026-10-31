
import "dotenv/config";
import http from "http";
import fs from "fs/promises";
import { parse } from "url";
import cron from "node-cron";
import { initiateBulkOperationOK } from "./initiate_bulk_operation.js";
import { initiateInsertData } from "./insert_bulk_data_to_file.js";
import { writeStatus } from "./utils/write_status.js";
import { getRecentTagCorrections } from "./utils/retrieve_recent_tag_corrrections.js";
import path from "path";
import { updateDescriptionAndTags } from "./utils/update-desc-and-tags.js";
import { convertLogsToCSV } from "./utils/convert_to_csv.js";
import { retainRecent15FilesOnly } from "./utils/retain_recent_15_only.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --------------------------------------------------
// GLOBAL LOCKS
// --------------------------------------------------

const MAX_JOB_DURATION = 2 * 24 * 60 * 60 * 1000; // 48 hours

global.isBulkOperationRunning ??= false;
global.bulkOperationStartedAt ??= null;

global.isFitmentSyncRunning ??= false;
global.fitmentSyncStartedAt ??= null;

// Reset a lock if its task has been running for 48 hours.
function resetStaleLock(lockName, startedAtName) {
  if (!global[lockName]) {
    return false;
  }

  const startedAt = global[startedAtName];

  if (
    !startedAt ||
    Date.now() - startedAt >= MAX_JOB_DURATION
  ) {
    console.warn(`Resetting stale lock: ${lockName}`);

    global[lockName] = false;
    global[startedAtName] = null;

    return true;
  }

  return false;
}

function releaseBulkOperationLock() {
  global.isBulkOperationRunning = false;
  global.bulkOperationStartedAt = null;
}

// --------------------------------------------------
// FITMENT SYNC
// --------------------------------------------------

async function syncFitmentData() {
  resetStaleLock(
    "isFitmentSyncRunning",
    "fitmentSyncStartedAt"
  );

  if (global.isFitmentSyncRunning) {
    console.log("Skipping fitment sync: task already running.");

    return { skipped: true };
  }

  global.isFitmentSyncRunning = true;
  global.fitmentSyncStartedAt = Date.now();

  try {
    console.log("Downloading fitment files from Google Drive...");

    await execFileAsync(
      "/usr/bin/rclone",
      [
        "sync",
        "gdrive:",
        "/root/eurowagens-backend/fitment/incoming",
        "--drive-root-folder-id",
        "1e4tXf7h7MY7n2mwLke-6i4fOsVcEWMan",
      ],
      {
        cwd: "/root/eurowagens-backend",
        timeout: 30 * 60 * 1000,
          maxBuffer: 100 * 1024 * 1024,

      }
    );

    console.log("Google Drive sync completed.");
    console.log("Importing fitment data into OpenSearch...");

    const { stdout, stderr } = await execFileAsync(
      "/usr/bin/node",
      [
        "fitment-data-and-products-sync-to-os/fitment-sync/from-server-file-to-database/index.js",
      ],
      {
        cwd: "/root/eurowagens-backend",
        timeout: 24 * 60 * 60 * 1000,
          maxBuffer: 100 * 1024 * 1024,

      }
    );
    
    console.log(stdout);
    console.error(stderr);
    console.log("Fitment sync completed successfully.");

    return { success: true };
  } catch (err) {
    console.error("Fitment sync failed:", err);
    throw err;
  } finally {
    global.isFitmentSyncRunning = false;
    global.fitmentSyncStartedAt = null;
  }
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
  });

  res.end(JSON.stringify(data));
}

function fireAndForget(url, failMessage, sub_operation) {
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
      }
    })
    .catch(async (err) => {
      console.error("Async error:", err);

      releaseBulkOperationLock();

      await writeStatus(
        "failed",
        failMessage,
        sub_operation
      );
    });
}

// --------------------------------------------------
// HTTP SERVER
// --------------------------------------------------

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const parsedUrl = parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // -----------------------------------------------
  // GET /download-updates-log
  // -----------------------------------------------

  if (
    method === "GET" &&
    pathname.includes("download-updates-log")
  ) {
    try {
      await convertLogsToCSV();

      const outputFile = "output.csv";
      const filePath = path.resolve(outputFile);
      const file = await fs.readFile(filePath);

      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="update-logs.csv"',
      });

      res.end(file);

      await fs.unlink(filePath);
    } catch (err) {
      console.error(err);

      if (!res.headersSent) {
        res.writeHead(500);
        res.end("CSV generation failed");
      }
    }

    return;
  }

  // -----------------------------------------------
  // GET /
  // -----------------------------------------------

  if (method === "GET" && pathname === "/") {
    try {
      const html = await fs.readFile(
        "./public/index.html",
        "utf-8"
      );

      res.writeHead(200, {
        "Content-Type": "text/html",
      });

      res.end(html);
    } catch (err) {
      console.error(err);

      res.writeHead(500);
      res.end("Failed to load UI");
    }

    return;
  }

  // -----------------------------------------------
  // GET /recent-tag-corrections-list
  // -----------------------------------------------

  if (
    method === "GET" &&
    pathname.includes("recent-tag-corrections-list")
  ) {
    try {
      const dirPath = path.resolve(
        "backups-for-invalid-products"
      );

      const files = await getRecentTagCorrections(dirPath);

      return sendJson(res, 200, files);
    } catch (err) {
      console.error("ERROR:", err);

      return sendJson(res, 500, {
        error: "Failed to load data",
      });
    }
  }

  // -----------------------------------------------
  // GET /status
  // -----------------------------------------------

  if (method === "GET" && pathname === "/status") {
    try {
      const data = await fs.readFile("status.json", "utf-8");

      return sendJson(res, 200, JSON.parse(data));
    } catch {
      return sendJson(res, 200, {
        status: "idle",
        message: "Ready",
        sub_operation: null,
      });
    }
  }

  // -----------------------------------------------
  // GET /retain-recent-15-files-only
  // -----------------------------------------------

  if (
    method === "GET" &&
    pathname === "/retain-recent-15-files-only"
  ) {
    try {
      await retainRecent15FilesOnly();

      return sendJson(res, 200, {
        success: true,
        message: "Recent files retained successfully.",
      });
    } catch (err) {
      console.error(err);

      return sendJson(res, 500, {
        success: false,
        error: "Failed to retain recent files.",
      });
    }
  }

  // -----------------------------------------------
  // GET /results
  // -----------------------------------------------

  if (method === "GET" && pathname === "/results") {
    try {
      const data = await fs.readFile(
        "most_recent_invalid_products.json",
        "utf-8"
      );

      return sendJson(res, 200, JSON.parse(data));
    } catch {
      return sendJson(res, 200, []);
    }
  }

  // -----------------------------------------------
  // GET /sync-fitment-data
  // -----------------------------------------------

  if (
    method === "GET" &&
    pathname === "/sync-fitment-data"
  ) {
    try {
      const result = await syncFitmentData();

      if (result.skipped) {
        return sendJson(res, 200, {
          success: true,
          skipped: true,
          message: "Fitment sync is already running. Skipped.",
        });
      }

      return sendJson(res, 200, {
        success: true,
        message: "Fitment sync completed successfully.",
      });
    } catch (err) {
      return sendJson(res, 500, {
        success: false,
        message: "Fitment sync failed.",
        error: err.message,
      });
    }
  }

  // -----------------------------------------------
  // GET /initiate-bulk-operation
  // -----------------------------------------------

  if (
    method === "GET" &&
    pathname === "/initiate-bulk-operation"
  ) {
    resetStaleLock(
      "isBulkOperationRunning",
      "bulkOperationStartedAt"
    );

    if (global.isBulkOperationRunning) {
      console.log("Skipping: bulk operation already running.");

      return sendJson(res, 200, {
        skipped: true,
        message: "Bulk operation already running, skipped.",
      });
    }

    // Acquire the lock before asynchronous work begins.
    global.isBulkOperationRunning = true;
    global.bulkOperationStartedAt = Date.now();

    try {
      await fs.writeFile(
        "started_at.json",
        JSON.stringify(
          { startedAt: new Date().toISOString() },
          null,
          2
        )
      );

      await writeStatus(
        "running",
        "Retrieving all products...",
        "initiate-bulk-operation"
      );

      await initiateBulkOperationOK();

      // Keep the lock until the downstream workflow finishes.
      return sendJson(res, 200, {
        message: "Bulk operation initiated successfully.",
      });
    } catch (err) {
      console.error(err);

      releaseBulkOperationLock();

      await writeStatus(
        "failed",
        "Failed to initiate bulk operation",
        "initiate-bulk-operation"
      );

      return sendJson(res, 500, {
        error: "Failed to initiate bulk operation.",
      });
    }
  }

  // -----------------------------------------------
  // POST /listen-to-bulk-op-completion-webhook
  // -----------------------------------------------

  if (
    method === "POST" &&
    pathname === "/listen-to-bulk-op-completion-webhook"
  ) {
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

      releaseBulkOperationLock();

      await writeStatus(
        "failed",
        "Webhook handling failed",
        "webhook"
      );

      if (!res.headersSent) {
        return sendJson(res, 500, {
          error: "Webhook handling failed.",
        });
      }
    }

    return;
  }

  // -----------------------------------------------
  // GET /start-saving-to-file
  // -----------------------------------------------

  if (
    method === "GET" &&
    pathname === "/start-saving-to-file"
  ) {
    try {
      await writeStatus(
        "running",
        "Saving products to file...",
        "start-saving-to-file"
      );

      await initiateInsertData();

      fireAndForget(
        process.env.SERVER_BASE_URL +
          "/update-description-and-tags",
        "Failed while validating tags",
        "update-description-and-tags"
      );

      return sendJson(res, 200, {
        message: "Data inserted into file.",
      });
    } catch (err) {
      console.error(err);

      releaseBulkOperationLock();

      await writeStatus(
        "failed",
        "Failed to save products to file",
        "start-saving-to-file"
      );

      return sendJson(res, 500, {
        error: "Insert failed.",
      });
    }
  }

  // -----------------------------------------------
  // GET /update-description-and-tags
  // -----------------------------------------------

  if (
    method === "GET" &&
    pathname === "/update-description-and-tags"
  ) {
    try {
      await writeStatus(
        "running",
        "Processing products...",
        "update-description-and-tags"
      );

      console.log("Syncing new and updated products...");

      await execFileAsync(
        "/usr/bin/node",
        [
          "fitment-data-and-products-sync-to-os/products-sync/new-and-updated-products/index.js",
        ],
        {
          cwd: "/root/eurowagens-backend",
          timeout: 5 * 60 * 60 * 1000,
          maxBuffer: 100 * 1024 * 1024,

        }
      );

      console.log("Products sync completed.");

      await updateDescriptionAndTags();

      await writeStatus(
        "completed",
        "Products scanned and tag inconsistencies resolved.",
        "completed"
      );

      releaseBulkOperationLock();

      return sendJson(res, 200, {
        message: "Validated and corrected tags.",
      });
    } catch (err) {
      console.error(err);

      releaseBulkOperationLock();

      await writeStatus(
        "failed",
        "Tag validation failed",
        "update-description-and-tags"
      );

      return sendJson(res, 500, {
        error: "Validation failed.",
      });
    }
  }

  // -----------------------------------------------
  // 404
  // -----------------------------------------------

  res.writeHead(404, {
    "Content-Type": "text/plain",
  });

  res.end("Not Found");
});

// --------------------------------------------------
// SERVER + CRON SCHEDULES
// --------------------------------------------------

const PORT = 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);

  // Daily fitment sync at 12:25 AM.
  cron.schedule("25 0 * * *", async () => {
    console.log("Scheduled fitment sync triggered.");

    try {
      await syncFitmentData();
    } catch (err) {
      console.error("Scheduled fitment sync failed:", err);
    }
  });

  // Daily bulk operation at 1:00 AM.
  cron.schedule("0 1 * * *", async () => {
    console.log("Bulk-operation cron triggered.");

    resetStaleLock(
      "isBulkOperationRunning",
      "bulkOperationStartedAt"
    );

    if (global.isBulkOperationRunning) {
      console.log("Skipping: bulk operation already running.");
      return;
    }

    try {
      const response = await fetch(
        process.env.SERVER_BASE_URL +
          "/initiate-bulk-operation"
      );

      if (!response.ok) {
        throw new Error(
          `Bulk-operation request failed: HTTP ${response.status}`
        );
      }

      await retainRecent15FilesOnly();
    } catch (err) {
      console.error("Bulk-operation cron failed:", err);
    }
  });
});
