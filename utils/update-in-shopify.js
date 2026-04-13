import { generateShopifyAccessToken } from "./access_token.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, retries = 5, delay = 500) {
  let attempt = 0;

  while (attempt < retries) {
    try {
      const res = await fetch(url, options);

      // Retry on 5xx or rate limit (429)
      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) {
          throw new Error(`Retryable error: ${res.status}`);
        }
      }

      return await res.json();
    } catch (err) {
      attempt++;

      if (attempt >= retries) {
        console.error(`Failed after ${retries} attempts`);
        throw err;
      }

      const backoff = delay * Math.pow(2, attempt); // exponential
      console.warn(`Retry ${attempt}/${retries} in ${backoff}ms`);

      await sleep(backoff);
    }
  }
}

export async function updateProductInShopify(product) {
  try {
    const shopifyAccessToken = await generateShopifyAccessToken();
    const shop = process.env.SHOPIFY_STORE;

    const url = `https://${shop}/admin/api/2026-01/graphql.json`;


    const query = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            tags
            descriptionHtml
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
      }
    };

    if(product.hasTagsChanged){
      variables.input.tags = product.newTags
    }

    if(product.hasDescriptionChanged){
      variables.input.descriptionHtml = product.newDescriptionHtml
    }
    
    try {
      const json = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyAccessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (json.data?.productUpdate?.userErrors?.length) {
        console.error("Error updating product:", product.id);
        console.error(json.data.productUpdate.userErrors);
      } else {
        console.log("Updated:", product.id);
      }

    } catch (err) {
      console.error("Final failure for product:", product.id);
      console.error(err.message);
    }

  } catch (err) {
    console.error("Shopify update failed:", err);
    throw err;
  }
}