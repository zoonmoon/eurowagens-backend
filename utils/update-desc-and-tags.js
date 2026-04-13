import fs from 'fs';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import { getCorrectedTags } from './correct-tags';
import { getCorrectedDescription } from './correct-description';
import { updateProductInShopify } from './update-in-shopify';

/**
 * Process large JSON file one item at a time (no batching)
 */

async function processLargeJsonOneByOne(filePath, processItem) {
  return new Promise((resolve, reject) => {
    const pipeline = chain([
      fs.createReadStream(filePath),
      parser(),
      streamArray()
    ]);

    pipeline.on('data', async ({ value }) => {
      pipeline.pause();

      try {
        await processItem(value);
      } catch (err) {
        // return reject(err);
        console.log(err)
      }

      pipeline.resume();
    });

    pipeline.on('end', resolve);
    pipeline.on('error', reject);
  });
}



async function processProduct(product) {

  let productWithCorrectedTags = getCorrectedTags(product)

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
  await processLargeJsonOneByOne(
    "products_in_json_form.json",
    processProduct
  );
}