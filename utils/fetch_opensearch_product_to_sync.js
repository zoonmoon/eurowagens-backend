import 'dotenv/config';  // ✅ this loads .env automatically

// lib/opensearchClient.js
import { Client } from '@opensearch-project/opensearch'

export const openSearchClient = new Client({
  node: `https://${process.env.OPENSEARCH_USERNAME}:${process.env.OPENSEARCH_PASSWORD}@${process.env.OPENSEARCH_HOST}:${process.env.OPENSEARCH_PORT}`,
  ssl: {
    rejectUnauthorized: false, // If using self-signed certificates or improperly configured certificates
  },
})


export  async function fetchOpensearchProductToSync() {
  try {
    const response = await openSearchClient.search({
      index: 'products', // ✅ replace with your actual index name
      body: {
        query: {
          bool: {
            must: [
              // { term: { 'status': 'ACTIVE' } }, // ✅ must be ACTIVE


              {
                bool: {
                  should: [
                    { term: { status: 'ACTIVE' } },
                    { term: { is_backordered: true } }
                  ],
                  minimum_should_match: 1
                }
              }


            ],
            should: [
              { term: { 'wheel_bolt_patterns': '8x180' } },
              { term: { 'wheel_bolt_patterns': '8x170' } },
              { term: { 'wheel_bolt_patterns': '6x5.5' } },

             {
                nested: {
                  path: 'collections',
                  query: {
                    term: {
                      'collections.id': 'gid://shopify/Collection/514642182458',
                    },
                  },
                },
              },


              
            ],
            minimum_should_match: 1,
          },
        },
        sort: [
          { 'last_rechecked_on_sdwheel_v2': { order: 'asc', missing: '_first', } }, // ascending,
                         // ✅ Include docs missing this field

        ],
        size: 1, // ✅ fetch only one document
      },
    });

    const hit = response.body.hits.hits[0]?._source;
    if (hit) {
      console.log('✅ Fetched product from os:');
      return hit; // return the full document
    } else {
      console.log('⚠️ No matching product found.');
      return null;
    }
    
    
  } catch (error) {
    console.error('❌ OpenSearch fetch error:', error);
    throw error;
  }
}
