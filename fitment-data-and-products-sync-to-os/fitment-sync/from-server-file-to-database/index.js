
import fs from "fs";
import path from "path";
import crypto from "crypto";
import csv from "csv-parser";
import { MAKE_NORMALIZATION_MAP } from "./normalization-map.js";
import openSearchClient from "../../utils/opensearch-client.js";

const FITMENT_DIR = path.resolve("./fitment/incoming");
const INDEX_NAME = "fitment_data";

const BATCH_SIZE = 10000;
const PROGRESS_INTERVAL = 10000;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;

const SOURCE_INDEX = `fitment_source_ids_${Date.now()}_${process.pid}`;

const REQUIRED_COLUMNS = [
  "Vehicle Type",
  "sku",
  "year",
  "make",
  "model",
  "sub_model",
  "engine",
];

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 2;
const ABORT_ON_REJECTED_ROWS = false;


/* -------------------- UTILITIES -------------------- */

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function createFitmentId({
  vehicle_type,
  product_sku,
  year,
  make,
  model,
  sub_model,
  engine,
}) {
  return crypto
    .createHash("sha256")
    .update([
      vehicle_type,
      product_sku,
      year,
      make,
      model,
      sub_model,
      engine,
    ].join("|"))
    .digest("hex");
}

function validateColumns(headers, fileName) {
  const missing = REQUIRED_COLUMNS.filter(
    (column) => !headers.includes(column)
  );

  if (missing.length) {
    throw new Error(
      `${fileName}: missing columns: ${missing.join(", ")}`
    );
  }
}

function validateRow(row) {
  const vehicle_type = normalize(row["Vehicle Type"]);
  const product_sku = normalize(row["sku"]);
  const yearValue = normalize(row["year"]);

  let make = normalize(row["make"]);
  make = MAKE_NORMALIZATION_MAP[make] ?? make;

  const model = normalize(row["model"]);
  const sub_model = normalize(row["sub_model"]);
  const engine = normalize(row["engine"]);

  const errors = [];

  if (!product_sku) errors.push("missing sku");
  if (!yearValue) errors.push("missing year");
  if (!make) errors.push("missing make");
  if (!model) errors.push("missing model");

  const year = Number(yearValue);

  if (
    yearValue &&
    (
      !Number.isInteger(year) ||
      year < MIN_YEAR ||
      year > MAX_YEAR
    )
  ) {
    errors.push(`invalid year "${yearValue}"`);
  }

  if (errors.length) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      vehicle_type,
      product_sku,
      year,
      make,
      model,
      sub_model,
      engine,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(operation, description) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `${description} failed after ${MAX_RETRIES} attempts: ` +
          (error?.message || error)
        );
      }

      const delay = INITIAL_RETRY_DELAY * 2 ** (attempt - 1);

      console.error(
        `⚠️ ${description}: attempt ${attempt}/${MAX_RETRIES} failed. ` +
        `Retrying in ${delay / 1000}s. Error: ${error?.message || error}`
      );

      await sleep(delay);
    }
  }
}


/* -------------------- BULK REQUESTS -------------------- */

/**
 * Handles index operations (action + document) and delete operations
 * (action only), retrying individual failed operations.
 */
async function bulkRequest(operations, description) {
  if (!operations.length) return;

  let pending = operations;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response;

    try {
      response = await openSearchClient.bulk({ body: pending });
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `${description} failed: ${error?.message || error}`
        );
      }

      const delay = INITIAL_RETRY_DELAY * 2 ** (attempt - 1);

      console.error(
        `⚠️ ${description}: bulk request failed; retrying in ${delay / 1000}s`
      );

      await sleep(delay);
      continue;
    }

    const body = response.body ?? response;

    if (!body.errors) return;

    const items = body.items ?? [];
    const failedOperations = [];
    let offset = 0;

    for (const item of items) {
      const action = Object.keys(item)[0];
      const result = item[action];

      if (!action || !result) {
        throw new Error(`${description}: invalid bulk response item`);
      }

      const operationLength = action === "delete" ? 1 : 2;

      if (result.error || result.status >= 300) {
        failedOperations.push(
          ...pending.slice(offset, offset + operationLength)
        );

        console.error(
          `⚠️ ${description}: ${action} failed:`,
          JSON.stringify(result.error ?? result.status)
        );
      }

      offset += operationLength;
    }

    if (offset !== pending.length) {
      throw new Error(
        `${description}: bulk response count mismatch. ` +
        `Expected ${offset} operations, request had ${pending.length} entries.`
      );
    }

    if (!failedOperations.length) return;

    if (attempt === MAX_RETRIES) {
      throw new Error(
        `${description}: ${failedOperations.length} request entries still failed`
      );
    }

    pending = failedOperations;

    const delay = INITIAL_RETRY_DELAY * 2 ** (attempt - 1);
    console.log(
      `🔁 Retrying ${pending.length} failed entries in ${delay / 1000}s`
    );

    await sleep(delay);
  }
}


/* -------------------- SOURCE ID INDEX -------------------- */

async function markSourceIds(ids) {
  if (!ids.length) return;

  const operations = [];

  for (const id of ids) {
    operations.push({
      index: {
        _index: SOURCE_INDEX,
        _id: id,
      },
    });

    operations.push({ source: true });
  }

  await bulkRequest(operations, "Index source IDs");
}


/* -------------------- UPSERT FITMENTS -------------------- */

async function upsertFitments(documents) {
  if (!documents.length) return;

  const operations = [];

  for (const { id, data } of documents) {
    operations.push({
      index: {
        _index: INDEX_NAME,
        _id: id,
      },
    });

    operations.push({
      product_sku: data.product_sku,
      vehicle_type: data.vehicle_type,
      make: data.make,
      model: data.model,
      year: data.year,
      sub_model: data.sub_model,
      engine: data.engine,
      notes: "",
    });
  }

  await bulkRequest(operations, "Upsert fitments");
}


/* -------------------- PROCESS CSV -------------------- */

async function processFile(filePath, mode, stats) {
  const fileName = path.basename(filePath);

  console.log("");
  console.log(
    `📄 ${mode === "source" ? "Scanning" : "Upserting"}: ${fileName}`
  );

  const stream = fs
    .createReadStream(filePath)
    .pipe(
      csv({
        mapHeaders: ({ header }) =>
          header
            .replace(/^\uFEFF/, "")
            .trim()
            .replace(/\s+/g, " "),
      })
    );

  let headersValidated = false;
  let totalRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  let batchNumber = 0;

  const rejectionReasons = {};

  let idBatch = [];
  let documentBatch = [];

  stream.on("headers", (headers) => {
    validateColumns(headers, fileName);
    headersValidated = true;

    console.log(`   ✅ Headers validated: ${headers.length} columns`);
    console.log("   📖 Starting row processing...");
  });

  async function flush() {
    if (mode === "source" && idBatch.length) {
      const batch = idBatch;

      console.log(
        `   📤 Source batch ${batchNumber + 1}: ` +
        `indexing ${batch.length.toLocaleString()} IDs...`
      );

      await markSourceIds(batch);

      stats.sourceRows += batch.length;
      idBatch = [];
      batchNumber++;

      console.log(
        `   ✅ Source batch ${batchNumber} complete. ` +
        `Valid rows read: ${validRows.toLocaleString()}`
      );
    }

    if (mode === "upsert" && documentBatch.length) {
      const batch = documentBatch;

      console.log(
        `   📤 Upsert batch ${batchNumber + 1}: ` +
        `${batch.length.toLocaleString()} documents...`
      );

      await upsertFitments(batch);

      stats.upsertedRows += batch.length;
      documentBatch = [];
      batchNumber++;

      console.log(
        `   ✅ Upsert batch ${batchNumber} complete. ` +
        `Valid rows read: ${validRows.toLocaleString()}`
      );
    }
  }

  try {
    for await (const row of stream) {
      if (!headersValidated) {
        throw new Error(`${fileName}: headers were not validated`);
      }

      totalRows++;

      if (totalRows % PROGRESS_INTERVAL === 0) {
        console.log(
          `   📊 ${fileName}: read ${totalRows.toLocaleString()} rows; ` +
          `${validRows.toLocaleString()} valid; ` +
          `${rejectedRows.toLocaleString()} rejected`
        );
      }

      const validation = validateRow(row);

      if (!validation.valid) {
        rejectedRows++;

        for (const reason of validation.errors) {
          rejectionReasons[reason] =
            (rejectionReasons[reason] || 0) + 1;
        }

        continue;
      }

      validRows++;

      const data = validation.data;
      const id = createFitmentId(data);

      if (mode === "source") {
        idBatch.push(id);
      } else {
        documentBatch.push({ id, data });
      }

      const currentBatchSize =
        mode === "source" ? idBatch.length : documentBatch.length;

      if (currentBatchSize >= BATCH_SIZE) {
        await flush();
      }
    }

    if (!headersValidated) {
      throw new Error(`${fileName}: no valid CSV headers found`);
    }

    await flush();

    console.log("");
    console.log(`   📋 Finished: ${fileName}`);
    console.log(`   Total rows: ${totalRows.toLocaleString()}`);
    console.log(`   Valid rows: ${validRows.toLocaleString()}`);
    console.log(`   Rejected rows: ${rejectedRows.toLocaleString()}`);
    console.log(`   Batches processed: ${batchNumber}`);

    for (const [reason, count] of Object.entries(rejectionReasons)) {
      console.log(`   ⚠️ ${reason}: ${count.toLocaleString()}`);
    }

    stats.totalRows += totalRows;
    stats.rejectedRows += rejectedRows;

    if (rejectedRows && ABORT_ON_REJECTED_ROWS) {
      throw new Error(
        `${fileName}: ${rejectedRows} invalid rows. ` +
        "Aborting before reconciliation can continue."
      );
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
}


/* -------------------- INDEX COUNT -------------------- */

async function getIndexCount(index) {
  const response = await withRetry(
    () => openSearchClient.count({ index }),
    `Count documents in ${index}`
  );

  return (response.body ?? response).count;
}


/* -------------------- COMPARE TARGET TO SOURCE -------------------- */

/**
 * For each target batch, query the temporary source index once using
 * an IDs query. Return only target IDs that are absent from the source.
 */
async function findMissingIds(hits) {
  if (!hits.length) return [];

  const ids = hits.map((hit) => hit._id);

  const response = await withRetry(
    () =>
      openSearchClient.search({
        index: SOURCE_INDEX,
        size: ids.length,
        _source: false,
        body: {
          query: {
            ids: { values: ids },
          },
        },
      }),
    "Compare target IDs with source index"
  );

  const body = response.body ?? response;
  const sourceHits = body.hits?.hits ?? [];

  const sourceIds = new Set(sourceHits.map((hit) => hit._id));

  return ids.filter((id) => !sourceIds.has(id));
}


/**
 * Iterate the target index using scroll pagination.
 * Calls onBatch with each batch's missing IDs.
 */
async function scanTargetIndex(onBatch, phaseLabel) {
  let scrollId;

  try {
    let response = await withRetry(
      () =>
        openSearchClient.search({
          index: INDEX_NAME,
          scroll: "2m",
          size: BATCH_SIZE,
          _source: false,
          body: {
            query: { match_all: {} },
          },
        }),
      `${phaseLabel}: start target scroll`
    );

    let body = response.body ?? response;
    scrollId = body._scroll_id;

    let scanned = 0;
    let batchNumber = 0;

    while (body.hits?.hits?.length) {
      const hits = body.hits.hits;

      const missingIds = await findMissingIds(hits);

      await onBatch(missingIds, {
        scanned: scanned + hits.length,
        batchNumber: batchNumber + 1,
        batchSize: hits.length,
      });

      scanned += hits.length;
      batchNumber++;

      console.log(
        `   🔎 ${phaseLabel}: checked ${scanned.toLocaleString()} target documents; ` +
        `${missingIds.length.toLocaleString()} missing in this batch`
      );

      response = await withRetry(
        () =>
          openSearchClient.scroll({
            scroll: "2m",
            scroll_id: scrollId,
          }),
        `${phaseLabel}: continue target scroll`
      );

      body = response.body ?? response;
      scrollId = body._scroll_id ?? scrollId;
    }

    return scanned;
  } finally {
    if (scrollId) {
      try {
        await openSearchClient.clearScroll({
          scroll_id: scrollId,
        });
      } catch (error) {
        console.error(
          "⚠️ Failed to clear target scroll:",
          error?.message || error
        );
      }
    }
  }
}


/* -------------------- DELETE OBSOLETE FITMENTS -------------------- */

async function deleteMissingFitments() {
  console.log("");
  console.log("========== PHASE 2: DELETE MISSING IDS ==========");
  console.log("📊 Pass 1/2: counting deletions; nothing is deleted yet.");

  let totalToDelete = 0;
  let totalScanned = 0;

  totalScanned = await scanTargetIndex(
    async (missingIds, progress) => {
      totalToDelete += missingIds.length;

      if (
        progress.scanned % PROGRESS_INTERVAL < BATCH_SIZE ||
        missingIds.length
      ) {
        console.log(
          `   📊 Deletion count so far: ${totalToDelete.toLocaleString()} ` +
          `obsolete out of ${progress.scanned.toLocaleString()} checked`
        );
      }
    },
    "Count pass"
  );

  console.log("");
  console.log("========== DELETION SUMMARY ==========");
  console.log(`Existing documents checked: ${totalScanned.toLocaleString()}`);
  console.log(`Total deletions to perform: ${totalToDelete.toLocaleString()}`);
  console.log("======================================");

  if (totalToDelete === 0) {
    console.log("✅ No obsolete fitments to delete.");
    return 0;
  }


  if(totalToDelete > 10000){
    console.log("Deletion limit reached") 
    return 0
  }
  
  console.log("");
  console.log("📊 Pass 2/2: deleting obsolete documents...");

  let deleted = 0;

  await scanTargetIndex(
    async (missingIds) => {
      if (!missingIds.length) return;

      const operations = missingIds.map((id) => ({
        delete: {
          _index: INDEX_NAME,
          _id: id,
        },
      }));

      await bulkRequest(operations, "Delete obsolete fitments");

      deleted += missingIds.length;

      const percentage = (deleted / totalToDelete) * 100;

      console.log(
        `   🗑️ Deletion progress: ${deleted.toLocaleString()} / ` +
        `${totalToDelete.toLocaleString()} (${percentage.toFixed(1)}%)`
      );
    },
    "Delete pass"
  );

  console.log("");
  console.log(`✅ Deletion completed: ${deleted.toLocaleString()} documents deleted.`);

  if (deleted !== totalToDelete) {
    console.warn(
      `⚠️ Counted ${totalToDelete} obsolete documents, but deleted ${deleted}. ` +
      "The target index may have changed during reconciliation."
    );
  }

  return deleted;
}


/* -------------------- MAIN SYNC -------------------- */

async function syncFitmentData() {
  let sourceIndexCreated = false;

  const stats = {
    totalRows: 0,
    rejectedRows: 0,
    sourceRows: 0,
    upsertedRows: 0,
  };

  try {
    console.log("");
    console.log("🚀 Starting fitment reconciliation");
    console.log(`📁 Directory: ${FITMENT_DIR}`);
    console.log(`🎯 Target index: ${INDEX_NAME}`);

    if (!fs.existsSync(FITMENT_DIR)) {
      throw new Error(`Directory does not exist: ${FITMENT_DIR}`);
    }

    const files = fs
      .readdirSync(FITMENT_DIR)
      .filter((file) => file.toLowerCase().endsWith(".csv"))
      .sort();

    if (!files.length) {
      throw new Error("No CSV files found. Refusing to delete fitments.");
    }

    console.log(`📁 Found ${files.length} CSV files`);

    console.log("");
    console.log(`🛠️ Creating temporary index: ${SOURCE_INDEX}`);

    await openSearchClient.indices.create({
      index: SOURCE_INDEX,
      body: {
        mappings: {
          properties: {
            source: { type: "boolean" },
          },
        },
      },
    });

    sourceIndexCreated = true;

    // PHASE 1: Build the combined source-ID set.
    console.log("");
    console.log("========== PHASE 1: BUILD SOURCE IDS ==========");

    for (let i = 0; i < files.length; i++) {
      console.log(`📁 Source file ${i + 1}/${files.length}`);

      await processFile(
        path.join(FITMENT_DIR, files[i]),
        "source",
        stats
      );
    }

    await withRetry(
      () => openSearchClient.indices.refresh({ index: SOURCE_INDEX }),
      "Refresh temporary source index"
    );

    const sourceCount = await getIndexCount(SOURCE_INDEX);

    console.log("");
    console.log("========== SOURCE INDEX SUMMARY ==========");
    console.log(`CSV files: ${files.length}`);
    console.log(`Valid source rows processed: ${stats.sourceRows.toLocaleString()}`);
    console.log(`Unique source IDs: ${sourceCount.toLocaleString()}`);
    console.log(`Rejected rows: ${stats.rejectedRows.toLocaleString()}`);
    console.log("==========================================");

    if (sourceCount < 1) {
      throw new Error(
        "Source index is empty. Refusing to delete existing fitments."
      );
    }

    if (ABORT_ON_REJECTED_ROWS && stats.rejectedRows > 0) {
      throw new Error("Invalid rows detected. Aborting before deletion.");
    }

    // PHASE 2: Count obsolete IDs and delete them before upserting.
    const deleted = await deleteMissingFitments();

    // PHASE 3: Upsert all valid CSV rows.
    console.log("");
    console.log("========== PHASE 3: UPSERT FITMENTS ==========");

    for (let i = 0; i < files.length; i++) {
      console.log(`📁 Upsert file ${i + 1}/${files.length}`);

      await processFile(
        path.join(FITMENT_DIR, files[i]),
        "upsert",
        stats
      );
    }

    await withRetry(
      () => openSearchClient.indices.refresh({ index: INDEX_NAME }),
      "Refresh fitment index"
    );

    const finalCount = await getIndexCount(INDEX_NAME);

    console.log("");
    console.log("==========================================");
    console.log("🎉 FITMENT RECONCILIATION COMPLETE");
    console.log("==========================================");
    console.log(`Files processed: ${files.length}`);
    console.log(`Unique source IDs: ${sourceCount.toLocaleString()}`);
    console.log(`Deleted documents: ${deleted.toLocaleString()}`);
    console.log(`Upserted rows: ${stats.upsertedRows.toLocaleString()}`);
    console.log(`Final target count: ${finalCount.toLocaleString()}`);
    console.log("==========================================");
  } finally {
    if (sourceIndexCreated) {
      console.log("");
      console.log(`🧹 Deleting temporary index: ${SOURCE_INDEX}`);

      try {
        await openSearchClient.indices.delete({
          index: SOURCE_INDEX,
        });

        console.log("✅ Temporary source index deleted");
      } catch (error) {
        console.error(
          "⚠️ Could not delete temporary index:",
          error?.message || error
        );
      }
    }
  }
}


syncFitmentData()
  .catch((error) => {
    console.error("");
    console.error("❌ FITMENT RECONCILIATION FAILED");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await openSearchClient.close();
    } catch (error) {
      console.error(
        "⚠️ Failed to close OpenSearch client:",
        error?.message || error
      );
    }
  });
