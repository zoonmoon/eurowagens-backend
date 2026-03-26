// Assumes Node.js 18+ for native fetch
export async function generateShopifyAccessToken() {
  const url = `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
    }),
  });

  if (!response.ok) throw new Error('Token request failed');
  const data = await response.json();
  return data.access_token; // The returned temporary token
}
