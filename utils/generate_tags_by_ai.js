import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function sanitizeTag(tag) {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, "") // remove invalid chars
    .replace(/\s+/g, "-")         // spaces -> hyphen
    .replace(/-+/g, "-")          // collapse hyphens
    .trim();
}

export async function generateTags({ title, vendor }) {
  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: `
You are a Shopify product tagging assistant.

Generate concise Shopify tags for this product.

Rules:
- Output ONLY a JSON array of strings
- Use only lowercase letters, numbers, and hyphens
- No accented characters
- No duplicates
- Max 15 tags
- Tags should help with filtering and search
- Include brand/vendor if relevant
- Generate based on Vendor and title only - nothing else - dont insert your own tags
Vendor: ${vendor}
Title: ${title}
`,
  });

  const raw = response.output_text;

  let tags = JSON.parse(raw);

  tags = tags.map(sanitizeTag);

  tags = [...new Set(tags)];

  return tags;
}


