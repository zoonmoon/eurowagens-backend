const fs = require('fs');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamArray } = require('stream-json/streamers/StreamArray');

/**
 * Process large JSON file one item at a time (no batching)
 *
 * @param {string} filePath
 * @param {function} processItem - async function(item)
 */
async function processLargeJsonOneByOne(filePath, processItem) {
  return new Promise((resolve, reject) => {

    const pipeline = chain([
      fs.createReadStream(filePath),
      parser(),
      streamArray()
    ]);

    pipeline.on('data', async ({ value }) => {
      pipeline.pause(); // ⛔ stop stream

      try {
        await processItem(value); // process ONE item
      } catch (err) {
        return reject(err);
      }

      pipeline.resume(); // ▶️ continue
    });

    pipeline.on('end', () => {
      resolve();
    });

    pipeline.on('error', reject);
  });
}


async function processProduct(product){

    console.log("from productdsfdfdss")
    console.log(product)


}

export async function updateDescriptionAndTags(){

    await processLargeJsonOneByOne(
        "products_in_json_form.json",
        processProduct
    )

}