import path from "path";

import {generateShopifyAccessToken} from './utils/access_token.js'

// insertProducts.js
import fs from "fs";
import readline from "readline";
import { backupCurrentProductsData } from "./utils/backup-file.js";

import { pipeline } from "stream/promises";
import { Readable } from "stream";



// export async function insertProductsToFileInJSONform(inputFilePath) {
//   try {
//     const rl = readline.createInterface({
//       input: fs.createReadStream(inputFilePath),
//       crlfDelay: Infinity,
//     });

//     const writeStream = fs.createWriteStream("products_from_shopify.txt", {
//       flags: "w",
//     });

//     let currentProduct = null;

//     for await (const line of rl) {
//       if (!line.trim()) continue;
//       const obj = JSON.parse(line);

//       // before 
//       // 🔹 New Product
//       if (obj.id?.startsWith("gid://shopify/Product/")) {

//         // ✅ flush previous product
//         if (currentProduct && currentProduct.status?.toLowerCase() === "active") {
//           writeStream.write(JSON.stringify(currentProduct) + "\n");
//         }

//         // start new product
//         currentProduct = {
//           id: obj.id,
//           tags: obj.tags || [],
//           title: obj.title, 
//           status: obj.status,
//           skus: [],
//           vendor: obj.vendor,
//           descriptionHtml: obj.descriptionHtml,
//           oem_number: ''
//         };
        
//         continue;
        
//       }

//       // 🔹 Metafield
//       if (
//         currentProduct &&
//         obj.id?.startsWith("gid://shopify/Metafield/") &&
//         obj.key === "oem_number" &&
//         obj.__parentId === currentProduct.id
//       ) {
//         currentProduct.oem_number = obj.value;
//       }

//       // Variant
//       if (
//         currentProduct &&
//         obj.id?.startsWith("gid://shopify/ProductVariant/") &&
//         obj.__parentId === currentProduct.id
//       ) {
//         if(obj.sku)
//           currentProduct.skus.push(obj.sku) 
//       }

//     }

//     // ✅ flush last product
//     if (currentProduct && currentProduct.status?.toLowerCase() === "active") {
//       writeStream.write(JSON.stringify(currentProduct) + "\n");
//     }

//     writeStream.end();

//     console.log("All products inserted successfully.");

//   } catch (err) {
//     console.error("Error inserting products:", err);
//     throw err;
//   }
// }

export async function insertProductsToFileInJSONform(inputFilePath) {
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(inputFilePath),
      crlfDelay: Infinity,
    });

    const writeStream = fs.createWriteStream("products_from_shopify.txt", {
      flags: "w",
    });

    let currentProduct = null;

    for await (const line of rl) {
      if (!line.trim()) continue;

      const obj = JSON.parse(line);

      // PRODUCT
      if (obj.id?.startsWith("gid://shopify/Product/")) {
        // Flush previous product
        if (
          currentProduct &&
          currentProduct.status?.toLowerCase() === "active"
        ) {
          writeStream.write(JSON.stringify(currentProduct) + "\n");
        }

        // Start new product
        currentProduct = {
          id: obj.id,
          status: obj.status,
          productType: obj.productType,
          title: obj.title,
          vendor: obj.vendor,
          handle: obj.handle,
          tags: obj.tags || [],
          descriptionHtml: obj.descriptionHtml,

          priceRange: obj.priceRangeV2 || null,

          // Featured image URL only
          featuredImage: obj.featuredMedia?.preview?.image?.url || null,

          // Media URLs only
          media: [],

          // Collections
          collections: [],

          // Variants
          variants: [],

          // Metafields
          metafields: [],

          // Keep existing convenient OEM field
          oem_number: "",

          // Existing SKU array
          skus: [],
        };

        continue;
      }

      // Ignore anything before the first product
      if (!currentProduct) continue;

      // MEDIA
      if (
        obj.__parentId === currentProduct.id &&
        obj.preview?.image?.url
      ) {
        currentProduct.media.push(obj.preview.image.url);

        continue;
      }

      // COLLECTION
      if (
        obj.id?.startsWith("gid://shopify/Collection/") &&
        obj.__parentId === currentProduct.id
      ) {
        currentProduct.collections.push({
          id: obj.id,
          title: obj.title,
          handle: obj.handle,
          description: obj.description,
        });

        continue;
      }

      // VARIANT
      if (
        obj.id?.startsWith("gid://shopify/ProductVariant/") &&
        obj.__parentId === currentProduct.id
      ) {
        currentProduct.variants.push({
          id: obj.id,
          sku: obj.sku || "",
          price: obj.price || null,
          availableForSale: obj.availableForSale ?? false,
          compareAtPrice: obj.compareAtPrice || null,
        });

        // Keep existing SKU array
        if (obj.sku) {
          currentProduct.skus.push(obj.sku);
        }

        continue;
      }

      // METAFIELD
      if (
        obj.id?.startsWith("gid://shopify/Metafield/") &&
        obj.__parentId === currentProduct.id
      ) {
        let metafieldValue = obj.value;

        // Convert list metafields from JSON string to actual array
        if (
          obj.type === "list.single_line_text_field" ||
          obj.type === "list.metaobject_reference"
        ) {
          try {
            metafieldValue = JSON.parse(obj.value);
          } catch {
            // Keep original value if it is not valid JSON
            metafieldValue = obj.value;
          }
        }

        currentProduct.metafields.push({
          id: obj.id,
          key: obj.key,
          type: obj.type,
          value: metafieldValue,
        });

        // Keep existing OEM number extraction
        if (obj.key === "oem_number") {
          currentProduct.oem_number = metafieldValue;
        }

        continue;
      }
    }

    // FLUSH LAST PRODUCT
    if (
      currentProduct &&
      currentProduct.status?.toLowerCase() === "active"
    ) {
      writeStream.write(JSON.stringify(currentProduct) + "\n");
    }

    writeStream.end();

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

  const filePath = path.join(process.cwd(), "bulk_operation_result.jsonl");

  await pipeline(
    Readable.fromWeb(res.body), // 🔥 convert Web → Node stream
    fs.createWriteStream(filePath)
  );

  console.log(`✅ File saved at: ${filePath}`);
  return filePath;
}


export async function initiateInsertData(){
    let fileUrl = await getShopifyBulkFileUrl()
    await saveBulkOperationFile(fileUrl) 
    await insertProductsToFileInJSONform(path.join(process.cwd(), "bulk_operation_result.jsonl"))
}