export function getCorrectedTags(product) {
  const originalTags = product.tags || [];
  const correctedTags = originalTags.map(t => t.toLowerCase());

  const hasTagsChanged = originalTags.some((tag, i) => tag !== correctedTags[i]);

  return {
    ...product,
    originalTags,        // ✅ preserve original
    newTags: correctedTags, // (optional but matches your earlier flow)
    hasTagsChanged
  };
}