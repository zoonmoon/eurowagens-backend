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

    const str = String(oemNumber).trim();
    const result = [];

    for (let start = 0; start < str.length; start++) {
      for (let end = start + 3; end <= str.length; end++) {
        result.push(str.slice(start, end));
      }
    }

    return result;
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
