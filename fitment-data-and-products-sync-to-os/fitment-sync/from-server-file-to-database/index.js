
import fs from "fs";
import path from "path";
import crypto from "crypto";
import csv from "csv-parser";

import openSearchClient from "../../utils/opensearch-client.js";

const FITMENT_DIR = path.resolve("./fitment/incoming");

const INDEX_NAME = "fitment_data";

const BATCH_SIZE = 1000;

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;


/**
 * Required CSV columns.
 */
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


/**
 * Normalize CSV value.
 *
 * We only clean whitespace.
 * We DO NOT remove punctuation because characters like
 * / - ( ) [ ] . , etc. can be meaningful automotive data.
 */
function normalize(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}


/**
 * Generate deterministic OpenSearch document ID.
 *
 * The same exact fitment will always generate
 * the same ID.
 */
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
    .update(
      [
        vehicle_type,
        product_sku,
        year,
        make,
        model,
        sub_model,
        engine,
      ].join("|")
    )
    .digest("hex");
}


/**
 * Validate CSV headers.
 *
 * The file must contain ALL required columns.
 * Extra columns are allowed.
 */
function validateColumns(headers, fileName) {
  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !headers.includes(column)
  );

  if (missingColumns.length > 0) {
    console.log(`⏭️ Skipping ${fileName}`);

    console.log(
      `   Missing columns: ${missingColumns.join(", ")}`
    );

    return false;
  }

  return true;
}


/**
 * Validate and normalize a single CSV row.
 */
function validateRow(row) {
  const vehicle_type = normalize(row["Vehicle Type"]);

  const product_sku = normalize(row["sku"]);

  const yearValue = normalize(row["year"]);

  const make = normalize(row["make"]);

  const model = normalize(row["model"]);

  const sub_model = normalize(row["sub_model"]);

  const engine = normalize(row["engine"]);

  const errors = [];


  // Vehicle type
  if (!vehicle_type) {
    errors.push("missing Vehicle Type");
  }


  // SKU
  if (!product_sku) {
    errors.push("missing sku");
  }


  // Year
  if (!yearValue) {
    errors.push("missing year");
  }

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


  // Make
  if (!make) {
    errors.push("missing make");
  }


  // Model
  if (!model) {
    errors.push("missing model");
  }


  // Sub model
  if (!sub_model) {
    errors.push("missing sub_model");
  }


  // Engine
  if (!engine) {
    errors.push("missing engine");
  }


  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
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


/**
 * Wait for a specified amount of time.
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


/**
 * Send a bulk request to OpenSearch with request-level retry logic.
 *
 * IMPORTANT:
 *
 * We ONLY retry if the OpenSearch request itself throws/fails.
 *
 * We intentionally DO NOT:
 *
 * - inspect response.body.errors
 * - inspect response.body.items
 * - inspect individual documents
 * - retry individual documents
 *
 * The complete bulk request is retried as-is.
 */
async function bulkInsert(
  operations,
  batchNumber
) {
  if (operations.length === 0) {
    return;
  }


  const rowsInBatch =
    operations.length / 2;


  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {

      await openSearchClient.bulk({
        body: operations,
      });


      // Request succeeded.
      if (attempt > 1) {
        console.log(
          `   ✅ Batch ${batchNumber.toLocaleString()} succeeded on attempt ${attempt}/${MAX_RETRIES}`
        );
      }


      return;

    } catch (error) {

      const isLastAttempt =
        attempt === MAX_RETRIES;


      /**
       * All retries exhausted.
       */
      if (isLastAttempt) {
        console.error("");

        console.error(
          `❌ Batch ${batchNumber.toLocaleString()} failed after ${MAX_RETRIES} attempts`
        );

        console.error(
          `   Rows in batch: ${rowsInBatch.toLocaleString()}`
        );

        console.error(
          `   Last error: ${error?.message || error}`
        );

        throw error;
      }


      /**
       * Exponential backoff:
       *
       * Attempt 1 fails → wait 1 second
       * Attempt 2 fails → wait 2 seconds
       * Attempt 3 fails → wait 4 seconds
       * Attempt 4 fails → wait 8 seconds
       */
      const retryDelay =
        INITIAL_RETRY_DELAY *
        Math.pow(2, attempt - 1);


      console.error("");

      console.error(
        `⚠️ Batch ${batchNumber.toLocaleString()} failed (attempt ${attempt}/${MAX_RETRIES})`
      );

      console.error(
        `   Rows in batch: ${rowsInBatch.toLocaleString()}`
      );

      console.error(
        `   Error: ${error?.message || error}`
      );

      console.error(
        `   Retrying in ${(retryDelay / 1000).toLocaleString()}s...`
      );


      await sleep(retryDelay);
    }
  }
}


/**
 * Process a single CSV file.
 */
async function processFile(filePath) {
  const fileName = path.basename(filePath);

  console.log("");
  console.log("=================================");
  console.log(`📄 Processing: ${fileName}`);
  console.log("=================================");


  return new Promise((resolve, reject) => {

    let stream;

    let headersValidated = false;

    let skipped = false;

    let operations = [];

    let totalRows = 0;

    let indexedRows = 0;

    let rejectedRows = 0;

    let batchNumber = 0;

    const rejectionReasons = {};


    /**
     * Add rejection reason to statistics.
     */
    function addRejectionReasons(errors) {
      for (const error of errors) {
        rejectionReasons[error] =
          (rejectionReasons[error] || 0) + 1;
      }
    }


    /**
     * Flush current bulk batch.
     */
    async function flushBatch() {

      if (operations.length === 0) {
        return;
      }


      const currentBatch =
        operations;


      operations = [];


      batchNumber++;


      /**
       * Send the complete batch.
       *
       * If the request fails, bulkInsert()
       * retries this exact batch.
       */
      await bulkInsert(
        currentBatch,
        batchNumber
      );


      const rowsInBatch =
        currentBatch.length / 2;


      indexedRows +=
        rowsInBatch;


      if (
        indexedRows % 10000 === 0
      ) {
        console.log(
          `   Indexed ${indexedRows.toLocaleString()} rows`
        );
      }
    }


    stream = fs
      .createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) =>
            header
              .replace(/^\uFEFF/, "")
              .trim()
              .replace(/\s+/g, " "),
        })
      )


      /**
       * CSV headers.
       */
      .on("headers", (headers) => {

        if (
          !validateColumns(
            headers,
            fileName
          )
        ) {

          skipped = true;

          stream.destroy();


          resolve({
            skipped: true,
            totalRows: 0,
            indexedRows: 0,
            rejectedRows: 0,
            rejectionReasons: {},
          });


          return;
        }


        headersValidated = true;


        console.log(
          `✅ Required columns found`
        );
      })


      /**
       * CSV row.
       */
      .on("data", async (row) => {

        if (
          skipped ||
          !headersValidated
        ) {
          return;
        }


        stream.pause();


        try {

          totalRows++;


          // Validate row.
          const validation =
            validateRow(row);


          // Invalid row.
          if (
            !validation.valid
          ) {

            rejectedRows++;


            addRejectionReasons(
              validation.errors
            );


            stream.resume();


            return;
          }


          const {
            vehicle_type,
            product_sku,
            year,
            make,
            model,
            sub_model,
            engine,
          } = validation.data;


          // Generate deterministic ID.
          const fitmentId =
            createFitmentId({
              vehicle_type,
              product_sku,
              year,
              make,
              model,
              sub_model,
              engine,
            });


          // Bulk metadata.
          operations.push({
            index: {
              _index: INDEX_NAME,
              _id: fitmentId,
            },
          });


          // Document.
          operations.push({

            product_sku,

            vehicle_type,

            make,

            model,

            year,

            sub_model,

            engine,

            notes: "",

          });


          /**
           * 2 bulk entries per document:
           *
           * 1. action
           * 2. document
           */
          if (
            operations.length >=
            BATCH_SIZE * 2
          ) {

            await flushBatch();

          }

        } catch (error) {

          stream.destroy(error);

          return;
        }


        stream.resume();
      })


      /**
       * File finished.
       */
      .on("end", async () => {

        if (skipped) {
          return;
        }


        try {

          // Flush remaining rows.
          await flushBatch();


          console.log("");

          console.log(
            `✅ Finished: ${fileName}`
          );


          console.log(
            `   Total rows:    ${totalRows.toLocaleString()}`
          );


          console.log(
            `   Indexed rows:  ${indexedRows.toLocaleString()}`
          );


          console.log(
            `   Rejected rows: ${rejectedRows.toLocaleString()}`
          );


          if (
            rejectedRows > 0
          ) {

            console.log("");

            console.log(
              "⚠️ Rejection reasons:"
            );


            for (
              const [
                reason,
                count,
              ] of Object.entries(
                rejectionReasons
              )
            ) {

              console.log(
                `   ${reason}: ${count.toLocaleString()}`
              );

            }
          }


          resolve({

            skipped: false,

            totalRows,

            indexedRows,

            rejectedRows,

            rejectionReasons,

          });

        } catch (error) {

          reject(error);

        }
      })


      /**
       * Stream error.
       */
      .on("error", (error) => {

        reject(error);

      });

  });
}


/**
 * Main sync function.
 */
async function syncFitmentData() {

  console.log("");

  console.log(
    "🚀 Starting fitment sync"
  );


  console.log(
    `📁 Directory: ${FITMENT_DIR}`
  );


  console.log(
    `📦 Batch size: ${BATCH_SIZE}`
  );


  console.log(
    `🔄 Max retries: ${MAX_RETRIES}`
  );


  console.log(
    `⏱️ Initial retry delay: ${INITIAL_RETRY_DELAY}ms`
  );


  // Check directory.
  if (
    !fs.existsSync(FITMENT_DIR)
  ) {

    throw new Error(
      `Fitment directory does not exist: ${FITMENT_DIR}`
    );

  }


  // Find CSV files.
  const files = fs
    .readdirSync(FITMENT_DIR)
    .filter(
      (file) =>
        file
          .toLowerCase()
          .endsWith(".csv")
    );


  if (
    files.length === 0
  ) {

    console.log(
      "⚠️ No CSV files found."
    );

    return;

  }


  console.log(
    `📁 Found ${files.length} CSV files`
  );


  let totalIndexed = 0;

  let totalRejected = 0;

  let skippedFiles = 0;


  // Process files one by one.
  for (
    const file of files
  ) {

    const filePath =
      path.join(
        FITMENT_DIR,
        file
      );


    try {

      const result =
        await processFile(
          filePath
        );


      if (
        result.skipped
      ) {

        skippedFiles++;

        continue;

      }


      totalIndexed +=
        result.indexedRows;


      totalRejected +=
        result.rejectedRows;


    } catch (error) {

      console.error("");

      console.error(
        `❌ Failed processing ${file}`
      );


      console.error(error);


      throw error;

    }
  }


  console.log("");

  console.log(
    "================================="
  );


  console.log(
    "🎉 FITMENT SYNC COMPLETE"
  );


  console.log(
    "================================="
  );


  console.log(
    `Files found:     ${files.length}`
  );


  console.log(
    `Files skipped:   ${skippedFiles}`
  );


  console.log(
    `Rows indexed:    ${totalIndexed.toLocaleString()}`
  );


  console.log(
    `Rows rejected:   ${totalRejected.toLocaleString()}`
  );


  console.log(
    "================================="
  );
}


/**
 * Run.
 */
syncFitmentData()

  .catch((error) => {

    console.error("");

    console.error(
      "❌ Fitment sync failed"
    );


    console.error(error);


    process.exitCode = 1;

  })

  .finally(async () => {

    await openSearchClient.close();

  });
