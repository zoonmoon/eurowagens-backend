import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔧 CHANGE THIS
const PRODUCT_COUNT = 1000;

const filePath = path.join(__dirname, "product-template.csv");

const headers = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Variant Price",
  "Variant SKU", 
  "product.metafields.eurowagens.oem_number"
];

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function randomDescription(length = 1000) {
  const chars = "abcdefghijklmnopqrstuvwxyz ";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("").trim();
}

function randomPrice() {
  return (Math.random() * 100 + 5).toFixed(2);
}

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, "-");
}

const rows = [];

for (let i = 1; i <= PRODUCT_COUNT; i++) {
  const title = `Product ${i} ${randomString(5)}`;
  const handle = slugify(title);
  const description = randomDescription(4);
  const price = randomPrice();
  const oem = randomString(16);

  rows.push([
    handle,
    title,
    `"${description}"`,
    price,
    oem,
    oem
  ]);
}

const csvContent = [
  headers.join(","),
  ...rows.map(row => row.join(","))
].join("\n");

fs.writeFileSync(filePath, csvContent, "utf8");

console.log(`✅ Generated ${PRODUCT_COUNT} products in product-template.csv`);