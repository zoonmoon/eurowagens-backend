
import fs from "fs";
import readline from "readline";
import openSearchClient from "../../utils/opensearch-client.js";

const INPUT_FILE = "products_from_shopify.txt";
const INDEX_NAME = "products";
const BATCH_SIZE = 500;

import { transformProduct } from "./utils.js";


// ---------------------------------------------------------
// BULK UPSERT
// ---------------------------------------------------------


// ---------------------------------------------------------
// READ ALL SHOPIFY PRODUCT IDS
// ---------------------------------------------------------

async function getShopifyProductIds() {
  console.log("📄 Reading Shopify product IDs...");

  const shopifyIds = new Set();

  const fileStream = fs.createReadStream(INPUT_FILE, {
    encoding: "utf8",
  });

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let totalLines = 0;

  for await (const line of rl) {
    totalLines++;

    const trimmedLine = line.trim();

    if (!trimmedLine) continue;

    let product;

    try {
      product = JSON.parse(trimmedLine);
    } catch (error) {
      throw new Error(
        `Invalid JSON on line ${totalLines}. Aborting to prevent incorrect deletions.`
      );
    }

    if (product?.id !== undefined && product?.id !== null) {
      shopifyIds.add(String(product.id));
    }
  }

  if (shopifyIds.size === 0) {
    throw new Error(
      "No Shopify product IDs found. Aborting to prevent incorrect deletions."
    );
  }

  console.log(`📦 Shopify products found: ${shopifyIds.size}`);

  return shopifyIds;
}


// ---------------------------------------------------------
// MARK PRODUCTS DELETED FROM SHOPIFY
// ---------------------------------------------------------


async function markDeletedProducts(shopifyIds) {
  console.log("🔎 Fetching product IDs from OpenSearch...");

  const openSearchIds = new Set();
  let scrollId = null;

  try {
    let response = await openSearchClient.search({
      index: INDEX_NAME,
      scroll: "2m",
      size: 5000,
      _source: false,
      body: {
        query: {
          match_all: {},
        },
      },
    });

    let result = response.body ?? response;

    scrollId = result._scroll_id;

    while (true) {
      const hits = result.hits?.hits || [];

      if (!hits.length) break;

      for (const hit of hits) {
        openSearchIds.add(String(hit._id));
      }

      console.log(
        `📦 Fetched ${openSearchIds.size} OpenSearch product IDs`
      );

      response = await openSearchClient.scroll({
        scroll_id: scrollId,
        scroll: "2m",
      });

      result = response.body ?? response;
      scrollId = result._scroll_id || scrollId;
    }
  } finally {
    if (scrollId) {
      try {
        await openSearchClient.clearScroll({
          scroll_id: scrollId,
        });
      } catch (error) {
        console.warn("⚠️ Could not clear OpenSearch scroll:", error.message);
      }
    }
  }

  console.log(`📦 Total OpenSearch products: ${openSearchIds.size}`);

  const deletedIds = [];

  for (const id of openSearchIds) {
    if (!shopifyIds.has(id)) {
      deletedIds.push(id);
    }
  }

  console.log(`🗑️ Products missing from Shopify: ${deletedIds.length}`);


  if(deletedIds.length > 500){
    console.log("Deletion failed becaues the limit reached")
    return 
  }

  console.log(`🗑️ Products missing from Shopify: ${deletedIds.length}`);

  let updated = 0;
  const DELETE_BATCH_SIZE = 500;

  for (let i = 0; i < deletedIds.length; i += DELETE_BATCH_SIZE) {
    const batch = deletedIds.slice(i, i + DELETE_BATCH_SIZE);
    const body = [];

    for (const id of batch) {
      body.push({
        update: {
          _index: INDEX_NAME,
          _id: id,
        },
      });

      body.push({
        doc: {
          status: "DELETED",
        },
      });
    }

    const response = await openSearchClient.bulk({
      body,
      refresh: false,
    });

    const bulkResult = response.body ?? response;

    if (bulkResult.errors) {
      const failures = (bulkResult.items || [])
        .filter((item) => item.update?.error)
        .map((item) => ({
          id: item.update._id,
          status: item.update.status,
          error: item.update.error,
        }));

      console.error(
        "❌ Failed status updates:",
        failures.slice(0, 10)
      );

      throw new Error(
        `${failures.length} products failed to update to DELETED.`
      );
    }

    updated += batch.length;

    console.log(
      `🗑️ Marked ${updated}/${deletedIds.length} products as DELETED`
    );
  }

  console.log(`✅ Marked ${updated} products as DELETED.`);
}


async function bulkUpsert(products) {
  if (!products.length) {
    return;
  }

  const body = [];

  for (const product of products) {
    if (!product.shopify_id) {
      continue;
    }

    body.push({
      update: {
        _index: INDEX_NAME,
        _id: product.shopify_id,
      },
    });

    body.push({
      doc: product,
      doc_as_upsert: true,
    });
  }

  if (!body.length) {
    return;
  }

  const response = await openSearchClient.bulk({
    body,
    refresh: false,
  });

  const result = response.body ?? response;

  if (result.errors) {
    const failedItems = [];

    for (const item of result.items || []) {
      const updateResult = item.update;

      if (updateResult?.error) {
        failedItems.push({
          id: updateResult._id,
          status: updateResult.status,
          error: updateResult.error,
        });
      }
    }

    console.error(
      `❌ ${failedItems.length} products failed in this batch`
    );

    for (const failed of failedItems.slice(0, 10)) {
      console.error(
        JSON.stringify(failed, null, 2)
      );
    }

    throw new Error(
      `OpenSearch bulk request contained ${failedItems.length} failed items.`
    );
  }

  return result;
}

// ---------------------------------------------------------
// MAIN IMPORTER
// ---------------------------------------------------------

async function importProducts() {



  try {
    console.log("🚀 Starting deleted propducts sync");
    const shopifyIds = await getShopifyProductIds();
    await markDeletedProducts(shopifyIds);

  } catch (error) {

    console.error(
      "⚠️ Failed to mark deleted products. Continuing import..."
    );
    console.error(error.message);
  }

  console.log("🚀 Starting Shopify → OpenSearch product import");

  console.log(`📄 Input file: ${INPUT_FILE}`);
  console.log(`📦 OpenSearch index: ${INDEX_NAME}`);
  console.log(`📦 Batch size: ${BATCH_SIZE}`);

  // -------------------------------------------------------
  // CHECK INPUT FILE
  // -------------------------------------------------------

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(
      `Input file not found: ${INPUT_FILE}`
    );
  }

  // -------------------------------------------------------
  // TEST OPENSEARCH CONNECTION
  // -------------------------------------------------------

  console.log("🔌 Testing OpenSearch connection...");

  const infoResponse =
    await openSearchClient.info();

  const info =
    infoResponse.body ?? infoResponse;

  console.log(
    `✅ Connected to OpenSearch ${info.version?.number || ""}`
  );

  // -------------------------------------------------------
  // STREAM INPUT FILE
  // -------------------------------------------------------

  const fileStream =
    fs.createReadStream(INPUT_FILE, {
      encoding: "utf8",
    });

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let batch = [];

  let totalLines = 0;
  let importedProducts = 0;
  let skippedLines = 0;
  let failedLines = 0;

  // -------------------------------------------------------
  // PROCESS EACH JSONL LINE
  // -------------------------------------------------------

  for await (const line of rl) {
    totalLines++;

    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    let product;

    try {
      product = JSON.parse(trimmedLine);
    } catch (error) {
      failedLines++;

      console.error(
        `❌ Invalid JSON on line ${totalLines}`
      );

      console.error(
        error.message
      );

      continue;
    }

    // -----------------------------------------------------
    // VALIDATE PRODUCT
    // -----------------------------------------------------

    if (!product?.id) {
      skippedLines++;

      console.warn(
        `⚠️ Skipping line ${totalLines}: missing Shopify product ID`
      );

      continue;
    }

    // -----------------------------------------------------
    // TRANSFORM
    // -----------------------------------------------------

    const transformedProduct =
      transformProduct(product);

    batch.push(transformedProduct);

    // -----------------------------------------------------
    // BULK INSERT
    // -----------------------------------------------------

    if (batch.length >= BATCH_SIZE) {
      await bulkUpsert(batch);

      importedProducts += batch.length;

      console.log(
        `✅ Imported ${importedProducts} products`
      );

      batch = [];
    }
  }

  // -------------------------------------------------------
  // FINAL BATCH
  // -------------------------------------------------------

  if (batch.length > 0) {
    await bulkUpsert(batch);

    importedProducts += batch.length;

    console.log(
      `✅ Imported ${importedProducts} products`
    );
  }

  // -------------------------------------------------------
  // REFRESH INDEX
  // -------------------------------------------------------

  console.log("🔄 Refreshing OpenSearch index...");

  await openSearchClient.indices.refresh({
    index: INDEX_NAME,
  });

  console.log("✅ OpenSearch index refreshed");

  // -------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------

  console.log("");
  console.log("========================================");
  console.log("        IMPORT COMPLETED");
  console.log("========================================");
  console.log(`Total lines:       ${totalLines}`);
  console.log(`Imported products: ${importedProducts}`);
  console.log(`Skipped lines:     ${skippedLines}`);
  console.log(`Failed lines:      ${failedLines}`);
  console.log("========================================");
}

// ---------------------------------------------------------
// RUN
// ---------------------------------------------------------

importProducts()
  .then(() => {
    console.log("🎉 Done");
    process.exit(0);
  })
  .catch((error) => {
    console.error("");
    console.error("❌ Import failed");
    console.error(error);
    process.exit(1);
  });
