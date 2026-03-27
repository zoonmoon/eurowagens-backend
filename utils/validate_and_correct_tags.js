import fs from "fs/promises";
import path from "path";
import { backupCurrentProductsData } from "./backup-file.js";
import { generateShopifyAccessToken } from "./access_token.js";


export async function updateInvalidTagsInShopify(invalidProducts) {
  try {
    const shopifyAccessToken = await generateShopifyAccessToken();
    const shop = process.env.SHOPIFY_STORE;

    const url = `https://${shop}/admin/api/2026-01/graphql.json`;

    for (const product of invalidProducts) {
      const correctedTags = (product.tags || []).map(t => t.toLowerCase());

      const query = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              tags
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          id: product.id,
          tags: correctedTags
        }
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyAccessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      const json = await res.json();

      if (json.data?.productUpdate?.userErrors?.length) {
        console.error("Error updating product:", product.id);
        console.error(json.data.productUpdate.userErrors);
      } else {
        console.log("Updated:", product.id);
      }
    }

    console.log("All invalid products processed.");
  } catch (err) {
    console.error("Shopify update failed:", err);
    throw err;
  }
}

export async function validateAndCorrectTags() {
  try {
    const filePath = "products_in_json_form.json";
    const invalidFilePath = "most_recent_invalid_products.json";

    const data = await fs.readFile(filePath, "utf-8");
    const products = JSON.parse(data);

    const invalidProducts = [];
    const correctedProducts = [];

    for (const product of products) {
      const tags = product.tags || [];

      const hasInvalidTag = tags.some(tag => tag !== tag.toLowerCase());

      if (hasInvalidTag) {
        invalidProducts.push(product);
      }
    }

    console.log("Invalid products:", invalidProducts.length);
    console.log("Corrected products:", correctedProducts.length);


    // ✅ Backup old invalid file (sync → safe)
    backupCurrentProductsData("backups-for-invalid-products", invalidFilePath);

    // ✅ Write new invalid products file
    await fs.writeFile(
      invalidFilePath,
      JSON.stringify(invalidProducts, null, 2),
      "utf-8"
    );

    console.log("Invalid products saved to file.");

    if(invalidProducts.length == 0) return

    updateInvalidTagsInShopify(invalidProducts)

  } catch (err) {
    console.error("Error validating tags:", err);
    throw err;
  }
}