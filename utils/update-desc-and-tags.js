import fs from 'fs';
import readline from "readline";
import { getCorrectedTags } from './correct-tags.js';
import { getCorrectedDescription } from './correct-description.js';
import { updateProductInShopify } from './update-in-shopify.js';

/**
 * Process large JSON file one item at a time (no batching)
 */

export async function processLargeTextBlockOneByOne(filePath, processorFn) {


  let productsProcessed = 0

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      let obj;
      try {
        obj = JSON.parse(line);
      } catch (err) {
        console.error("Skipping invalid JSON line:", line);
        continue;
      }

      // 🔥 process one product at a time
      await processorFn(obj);
      productsProcessed++
      console.log("productsProcessed", productsProcessed)

    }

    
    console.log("Finished processing all products ✅");

  } catch (err) {
  
    console.error("Error processing file:", err);
  
    throw err;
  
  }
}


async function processProduct(product) {

  let productWithCorrectedTags = await getCorrectedTags(product)

  let productWithCorrectedDescription = getCorrectedDescription(product) 

  let comboProductDetails = {
    ...product, 
    ...productWithCorrectedTags,
    ...productWithCorrectedDescription
  }

  if(
    comboProductDetails.hasTagsChanged || 
    comboProductDetails.hasDescriptionChanged
  ){

    comboProductDetails.date = new Date().toISOString();
    
    try{

      await updateProductInShopify(comboProductDetails)

      fs.appendFileSync(
        "update-logs.txt",
        JSON.stringify(comboProductDetails) + "\n"
      );

    }catch(err){
      console.log(err)
    } 

  } 

}

export async function updateDescriptionAndTags() {
  await processLargeTextBlockOneByOne(
    "products_from_shopify.txt",
    processProduct
  );
}