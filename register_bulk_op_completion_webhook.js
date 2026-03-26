import 'dotenv/config';
import { generateShopifyAccessToken } from './utils/access_token.js';

const CALLBACK_URL = process.env.SERVER_BASE_URL + '/listen-to-bulk-op-completion-webhook';

export async function registerOrUpdateBulkWebhook(callbackUrl) {
    const shop = process.env.SHOPIFY_STORE;
    const accessToken = await generateShopifyAccessToken();
    const apiUrl = `https://${shop}/admin/api/2024-01/graphql.json`;

    // 1. Query to find if the webhook already exists
    const checkQuery = `
    {
      webhookSubscriptions(first: 10, topics: BULK_OPERATIONS_FINISH) {
        edges {
          node {
            id
            endpoint {
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }`;

    try {
        const checkRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ query: checkQuery }),
        });

        const checkData = await checkRes.json();
        const webhooks = checkData.data?.webhookSubscriptions?.edges || [];
        
        // Find if there's an existing subscription for this topic
        const existingWebhook = webhooks[0]?.node;

        if (existingWebhook) {
            if (existingWebhook.endpoint.callbackUrl === callbackUrl) {
                console.log("✅ Webhook already exists with current URL. No action needed.");
                return existingWebhook.id;
            }

            // 2. UPDATE existing webhook (Perfect for ngrok changes)
            console.log("🔄 Webhook exists with old URL. Updating to:", callbackUrl);
            return await updateWebhook(apiUrl, accessToken, existingWebhook.id, callbackUrl);
        }

        // 3. CREATE new webhook
        console.log("🆕 No webhook found. Creating new subscription...");
        return await createWebhook(apiUrl, accessToken, callbackUrl);

    } catch (err) {
        console.error("❌ Error in Webhook Setup:", err);
    }
}

async function createWebhook(apiUrl, accessToken, callbackUrl) {
    const mutation = `
    mutation webhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { message }
      }
    }`;

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({
            query: mutation,
            variables: {
                topic: "BULK_OPERATIONS_FINISH",
                webhookSubscription: { format: "JSON", callbackUrl }
            }
        }),
    });
    const result = await res.json();
    console.log("✅ Created Successfully:", result.data.webhookSubscriptionCreate.webhookSubscription.id);
}

async function updateWebhook(apiUrl, accessToken, webhookId, callbackUrl) {
    const mutation = `
    mutation webhookUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { message }
      }
    }`;

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({
            query: mutation,
            variables: {
                id: webhookId,
                webhookSubscription: { callbackUrl }
            }
        }),
    });
    const result = await res.json();
    console.log("✅ Updated Successfully:", result.data.webhookSubscriptionUpdate.webhookSubscription.id);
}

// Run it
registerOrUpdateBulkWebhook(CALLBACK_URL);