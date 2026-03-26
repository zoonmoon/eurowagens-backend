import {generateShopifyAccessToken} from './utils/access_token.js'

export async function shopifyGraphQL(query, variables = {}) {
  try{
    const url = `https://${process.env.SHOPIFY_STORE}/admin/api/${process.env.API_VERSION}/graphql.json`;

    let accessToken = await generateShopifyAccessToken()

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store", // Next.js App Router: disable caching
    });

    const data = await response.json();

    if (data.data.bulkOperationRunQuery.userErrors.length > 0) throw new Error(JSON.stringify(data.data.bulkOperationRunQuery.userErrors));
    
    return data.data;

  }catch(err){
    throw err 
  }

}


export async function startBulkOperation(query) {
  try{
    const mutation = `
      mutation bulkOperationRunQuery($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const result = await shopifyGraphQL(mutation, { query });

    return result.bulkOperationRunQuery.bulkOperation;
  }catch(err){
    throw err 
  }

}


export async function fetchProductsWithCollectionsAndMetafields() {
  
  try{

    // const bulkQuery = `
    //   {
    //     products(status:active){
    //       edges {
    //         node {
    //           id
    //           tags
    //           description
    //           # ✅ Product metafields
    //           metafields(first: 1, namespace:'custom', key:'oem_number') {
    //             edges {
    //               node {
    //                 value
    //               }
    //             }
    //           }

    //           # ✅ First variant with price
    //           variants(first: 1) {
    //             edges {
    //               node {
    //                 id
    //                 sku
    //               }
    //             }
    //           }
    //         }
    //       }
    //     }
    //   }
    // `;

    const bulkQuery = `
      {
        products(status: active) {
          edges {
            node {
              id
              tags
              description
              # No 'first' argument, no 'edges/node' wrapper
              metafields(namespace: "custom", key: "oem_number") {
                value
                namespace
                key
              }
              # No 'first' argument, no 'edges/node' wrapper
              variants {
                id
                sku
              }
            }
          }
        }
      }
    `

    return await startBulkOperation(bulkQuery);
  }catch(err){
    throw err 
  }

}

export async function initiateBulkOperationOK(){
    await fetchProductsWithCollectionsAndMetafields()
}