import {generateShopifyAccessToken} from './utils/access_token.js'

export async function shopifyGraphQL(query, variables = {}) {
  try{
    const url = `https://${process.env.SHOPIFY_STORE}/admin/api/${process.env.API_VERSION}/graphql.json`;

    let accessToken = await generateShopifyAccessToken()

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
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

    const bulkQuery = `
      {
        products{
          edges {
            node {
              id
              status
              tags
              description
              metafields(first: 250) {
                edges {
                  node {
                    id
                    value
                  }
                }
              }
            }
          }
        }
      }
    `;

    return await startBulkOperation(bulkQuery);
  }catch(err){
    throw err 
  }

}

export async function initiateBulkOperationOK(){
    await fetchProductsWithCollectionsAndMetafields()
}