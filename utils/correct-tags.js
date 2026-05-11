import { generateTags } from "./generate_tags_by_ai.js";
export async function getCorrectedTags(product) {
  const originalTags = product.tags || [];
  
  let correctedTags = originalTags.map(t => t.toLowerCase());
  
  if(originalTags.length == 0){
    try{
      correctedTags = await generateTags({
        vendor: product.vendor,
        title: product.title,
      });
    }catch(error){
      correctedTags = originalTags
    }
  }

  console.log(product.title)

  var hasTagsChanged = originalTags.length === 0 && correctedTags.length > 0
    
  return {
    ...product,
    originalTags,        // ✅ preserve original
    newTags: correctedTags, // (optional but matches your earlier flow)
    hasTagsChanged
  };
}