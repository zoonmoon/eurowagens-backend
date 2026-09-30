import "dotenv/config";

import { Client } from "@opensearch-project/opensearch";

const openSearchClient = new Client({
  node: `https://${process.env.OPENSEARCH_USERNAME}:${process.env.OPENSEARCH_PASSWORD}@${process.env.OPENSEARCH_HOST}:${process.env.OPENSEARCH_PORT}`,
});

export default openSearchClient;