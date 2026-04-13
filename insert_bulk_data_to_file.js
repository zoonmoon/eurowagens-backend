import path from "path";

import {generateShopifyAccessToken} from './utils/access_token.js'

// insertProducts.js
import fs from "fs";
import readline from "readline";
import { backupCurrentProductsData } from "./utils/backup-file.js";

export async function insertProductsToFileInJSONform(inputFilePath) {
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(inputFilePath),
      crlfDelay: Infinity,
    });

    const products = {};

    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);

      // Product line
      if (obj.id?.startsWith("gid://shopify/Product/")) {
        products[obj.id] = {
          id: obj.id,
          tags: obj.tags || [],
          status: obj.status,
          descriptionHtml: obj.descriptionHtml
        };
        continue;
      }

      if (obj.__parentId && products[obj.__parentId]) {
        const parent = products[obj.__parentId];

        if (obj.id?.startsWith("gid://shopify/Metafield/")) {

          let value = obj.value;
          let originalValue = value 
          
          if(obj.key == "oem_number") {
            parent[obj.key] = originalValue;
          }

        } 
      }
    }

    const allProducts = Object.values(products).filter(p => p.status.toLowerCase() == "active");

    backupCurrentProductsData("backups", "products_in_json_form.json");
    
    fs.writeFileSync(
      "products_in_json_form.json",
      JSON.stringify(allProducts, null, 2),
      "utf-8"
    );

    console.log("All products inserted successfully.");

  } catch (err) {
    console.error("Error inserting products:", err);
    throw err;
  }
}

async function getShopifyBulkFileUrl() {
  
  const shopifyDomain = process.env.SHOPIFY_STORE;
  
  const accessToken = await generateShopifyAccessToken(); // Store your private token in .env

  const apiVersion = process.env.API_VERSION;

  const query = `
    query {
      currentBulkOperation(type: QUERY) {
        id
        status
        objectCount
        createdAt
        completedAt
        errorCode
        url
      }
    }
  `;

  const response = await fetch(`https://${shopifyDomain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();

  // Optional: Log the full object for debugging
  console.log("Bulk Operation Data:", data.data.currentBulkOperation);
  
  // Extract and return the file URL
  const bulkOperation = data?.data?.currentBulkOperation;
  if (bulkOperation?.status === "COMPLETED" && bulkOperation?.url) {
    return bulkOperation.url;
  } else {
    throw new Error(`Bulk operation not completed yet. Status: ${bulkOperation?.status}`);
  }
}

async function saveBulkOperationFile(fileUrl) {

  backupCurrentProductsData("backups-for-json-l", "bulk_operation_result.jsonl");

  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to download file: ${res.statusText}`);

  const buffer = await res.arrayBuffer();
  const filePath = path.join(process.cwd(), "bulk_operation_result.jsonl"); // NDJSON format

  fs.writeFileSync(filePath, Buffer.from(buffer));

  console.log(`✅ File saved at: ${filePath}`);
  return filePath;
}

export async function initiateInsertData(){
    let fileUrl = await getShopifyBulkFileUrl()
    await saveBulkOperationFile(fileUrl) 
    await insertProductsToFileInJSONform(path.join(process.cwd(), "bulk_operation_result.jsonl"))
}