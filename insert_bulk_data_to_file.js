import path from "path";

import {generateShopifyAccessToken} from './utils/access_token.js'

// insertProducts.js
import fs from "fs";
import readline from "readline";

export async function insertProductsToDBFromNdjson(inputFilePath) {
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
          title: obj.title,
          status: obj.status,
          handle: obj.handle,
          featuredImage: obj.featuredImage || null,
          collections: [],
          metafields: [],
          variants: [],
          wheel_offset: null,
          wheel_diameter: null,
          wheel_width: null,
          wheel_hub_bore: null,
          tire_rim_diameter: null,
          aspect_ratio: null,
          section_width: null,
          wheel_bolt_patterns: null,
          price: null, // top-level product price
        };
        continue;
      }

      if (obj.__parentId && products[obj.__parentId]) {
        const parent = products[obj.__parentId];

        if (obj.id?.startsWith("gid://shopify/Collection/")) {
          parent.collections.push({ id: obj.id });

        } else if (obj.id?.startsWith("gid://shopify/Metafield/")) {

          let value = obj.value;
          let originalValue = value 

          if(!filters.includes(obj.key) || obj.type == "list.single_line_text_field" ){
            if(obj.type == "list.single_line_text_field"){
              let v = JSON.parse(originalValue)
              if(v.length > 0){
                v.forEach(vv => {
                  parent.metafields.push({ key: 'custom-'+ obj.key, value: vv });
                })

                console.log(parent.metafields)

              }
            }
            continue;
          }

          // Numeric fields in wheels
          if (['wheel_offset', 'wheel_diameter', 'wheel_width', 'wheel_hub_bore'].includes(obj.key)) {
            value = parseFloat(obj.value.replace('+', '')) || 0;
            parent[obj.key] = value;
          }

          if(obj.key == "wheel_bolt_patterns") {
            parent[obj.key] = originalValue;
          }

          // Tire numeric fields
          if (['tire_rim_diameter', 'aspect_ratio', 'section_width'].includes(obj.key)) {
            value = parseFloat(obj.value) || 0;
            parent[obj.key] = value;


            const { section_width, aspect_ratio, tire_rim_diameter } = parent;
            // ✅ if all 3 are present and non-zero, add concatenated tag
            if (section_width && aspect_ratio && tire_rim_diameter) {
              parent.tags = [`${section_width}${aspect_ratio}${tire_rim_diameter}`];
            }
            
          }
          
          parent.metafields.push({ key: obj.key, value: originalValue });
          
        } else if (obj.id?.startsWith("gid://shopify/ProductVariant/")) {
          const variantPrice = parseFloat(obj.price) || 0;
          parent.variants.push({
            id: obj.id,
            sku: obj.sku,
            price: variantPrice,
            compareAtPrice: obj.compareAtPrice,
          });

          // Update product price: take min of all variants
          if (parent.price === null || variantPrice < parent.price) {
            parent.price = variantPrice;
          }
        }
      }
    }

    const allProducts = Object.values(products);

    for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
      const batch = allProducts.slice(i, i + BATCH_SIZE);
      console.log(batch[0]);
      await insertBatchOfProductsToDB(batch);
      console.log(`Inserted batch ${i / BATCH_SIZE + 1}`);
    }

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
    await insertProductsToDBFromNdjson(path.join(process.cwd(), "bulk_operation_result.jsonl"))
}