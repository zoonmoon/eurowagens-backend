export function getCorrectedDescription(product){

  let descriptionHtml = product.descriptionHtml

  if(
    descriptionHtml.includes('partial-skus') ||
    (
      !product.oem_number ||
      product.oem_number.toString().trim().length < 4
    )

  )
    return {
      ...product,
      newDescriptionHtml: descriptionHtml,
      oldDescriptionHtml: descriptionHtml,
      hasDescriptionChanged: false,
    }

  
  function generatePartialSkus(oemNumber) {
    if (!oemNumber) return [];

    const oems = String(oemNumber)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const result = new Set();

    for (const oem of oems) {
      for (let start = 0; start < oem.length; start++) {
        for (let end = start + 3; end <= oem.length; end++) {
          result.add(oem.slice(start, end));
        }
      }
    }

    return Array.from(result);
  } 

  let partialOemSKUs =   generatePartialSkus(product.oem_number)

  var newDescriptionHtml = `
    ${product.descriptionHtml}
    <div class="partial-skus" style="display:none">
        ${partialOemSKUs.join(' , ')}
    </div>
  ` 
  return {
      ...product,
      newDescriptionHtml: newDescriptionHtml,
      oldDescriptionHtml: descriptionHtml,
      hasDescriptionChanged: true,
    }

}

