
// Only these Shopify metafields are imported into custom_fields
const INCLUDED_METAFIELDS = {
  "part_category": "Part Category" ,
  "product_group":  "Part Type",
  // "traffic_side": "Traffic Side",
  "motorcycle_collection": "Motorcycle Collection", 
  "motorcycle_part_type": "Motorcycle Part Type",
  "fitting_position": "Fitting Position",
}




function isEmptyValue(value) {
  return value === null || value === undefined || value === "";
}

function formatLabel(key) {
  if (!key) return "";

  return String(key)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


function addCustomField(customFields, label, value) {
  if (!label || isEmptyValue(value)) return;

  customFields.push({
    label: String(label),
    value: String(value),
  });
}


/**
 * Converts Shopify metafield values into usable JS values.
 *
 * Handles:
 * - actual arrays
 * - JSON strings containing arrays
 * - JSON strings containing objects
 * - normal scalar values
 */
function parseMetafieldValue(value) {
  if (isEmptyValue(value)) {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    // Try to parse JSON values such as:
    // ["Cars", "Motorcycles"]
    // {"foo":"bar"}
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON, treat it as a normal string
      }
    }

    return trimmed;
  }

  return value;
}


export function transformProduct(product) {
  const variants = Array.isArray(product.variants)
    ? product.variants
    : [];

  const metafields = Array.isArray(product.metafields)
    ? product.metafields
    : [];

  const productCollections = Array.isArray(product.collections)
    ? product.collections
    : [];

  // ---------------------------------------------------------
  // PRICE
  // ---------------------------------------------------------

  const minPrice =
    product?.priceRange?.minVariantPrice?.amount !== undefined
      ? Number(product.priceRange.minVariantPrice.amount)
      : null;

  const maxPrice =
    product?.priceRange?.maxVariantPrice?.amount !== undefined
      ? Number(product.priceRange.maxVariantPrice.amount)
      : null;

  const currency =
    product?.priceRange?.minVariantPrice?.currencyCode ||
    product?.priceRange?.maxVariantPrice?.currencyCode ||
    null;

  // ---------------------------------------------------------
  // MPN
  // ---------------------------------------------------------

  const manufacturerPartNumber = metafields.find(
    (metafield) => metafield?.key === "manufacturer_part_number"
  );

  const mpn = !isEmptyValue(manufacturerPartNumber?.value)
    ? String(manufacturerPartNumber.value)
    : null;

  // ---------------------------------------------------------
  // OEM NUMBER
  // ---------------------------------------------------------

  const oemNumber = !isEmptyValue(product.oem_number)
    ? String(product.oem_number)
    : "";

  // ---------------------------------------------------------
  // COLLECTION IDS
  // ---------------------------------------------------------

  // OpenSearch top-level `collections` contains ONLY IDs.
  const collectionIds = productCollections
    .map((collection) => collection?.id)
    .filter(Boolean)
    .map(String);

  // ---------------------------------------------------------
  // AVAILABILITY
  // ---------------------------------------------------------

  // Product is In Stock if at least one variant is available.
  const hasAvailableVariant = variants.some(
    (variant) => variant?.availableForSale === true
  );

  const availability = hasAvailableVariant
    ? "In Stock"
    : "Back soon";
  
  // ---------------------------------------------------------
  // CUSTOM FIELDS
  // ---------------------------------------------------------

  const customFields = [];



  // Brand
  addCustomField(
    customFields,
    "Brand",
    product.vendor
  );

  // Category = collection title
  // if (Array.isArray(productCollections)) {
  //   for (const collection of productCollections) {
  //     if (!collection?.title) continue;

  //     addCustomField(
  //       customFields,
  //       "Category",
  //       collection.title
  //     );
  //   }
  // }

  // ---------------------------------------------------------
  // SELECTED METAFIELDS ONLY
  // ---------------------------------------------------------

  for (const metafield of metafields) {
    if (!metafield?.key) continue;

    if (!Object.keys(INCLUDED_METAFIELDS).includes(metafield.key)) {
      continue;
    }

    const label = INCLUDED_METAFIELDS[metafield.key] ||  formatLabel(metafield.key);
    const parsedValue = parseMetafieldValue(metafield.value);

    if (isEmptyValue(parsedValue)) {
      continue;
    }

    // Array values become multiple custom field entries.
    //
    // Example:
    //
    // vehicle_types = ["Cars", "Motorcycles"]
    //
    // becomes:
    //
    // { label: "Vehicle Types", value: "Cars" }
    // { label: "Vehicle Types", value: "Motorcycles" }

    if (Array.isArray(parsedValue)) {
      for (const item of parsedValue) {
        if (isEmptyValue(item)) continue;

        // If an array somehow contains objects, stringify them.
        if (typeof item === "object") {
          addCustomField(
            customFields,
            label,
            JSON.stringify(item)
          );
        } else {
          addCustomField(
            customFields,
            label,
            item
          );
        }
      }

      continue;
    }

    // Scalar metafield
    if (typeof parsedValue === "object") {
      addCustomField(
        customFields,
        label,
        JSON.stringify(parsedValue)
      );
    } else {
      addCustomField(
        customFields,
        label,
        parsedValue
      );
    }
  }

  // ---------------------------------------------------------
  // AVAILABILITY CUSTOM FIELD
  // ---------------------------------------------------------

  addCustomField(
    customFields,
    "Availability",
    availability
  );

  // ---------------------------------------------------------
  // VARIANTS
  // ---------------------------------------------------------

  const normalizedVariants = variants.map((variant) => ({
    id: variant?.id ? String(variant.id) : null,

    price:
      variant?.price !== undefined &&
      variant?.price !== null &&
      variant?.price !== ""
        ? Number(variant.price)
        : null,

    compare_at_price:
      variant?.compareAtPrice !== undefined &&
      variant?.compareAtPrice !== null &&
      variant?.compareAtPrice !== ""
        ? Number(variant.compareAtPrice)
        : null,

    // IMPORTANT:
    // Keep this as a BOOLEAN.
    //
    // Do NOT convert it to "In Stock" / "Out of Stock".
    available_for_sale:
      variant?.availableForSale === true,
  }));

  // ---------------------------------------------------------
  // FINAL PRODUCT DOCUMENT
  // ---------------------------------------------------------

  // console.log(customFields.filter(cf => cf.label.toLowerCase() == 'tag'))
  

  return {
    shopify_id: product.id || null,

    handle: product.handle || null,

    status: product.status || null,

    created_at: product.created_at || null,

    title: product.title || null,

    product_type: product.productType || null,

    brand: product.vendor || null,

    tags: Array.isArray(product.tags)
      ? product.tags
          .filter(Boolean)
          .map(String)
      : [],

    description: product.descriptionHtml || null,

    // Product-level SKU list.
    //
    // SKU is intentionally NOT stored inside each variant.
    skus: Array.isArray(product.skus)
      ? product.skus
          .filter(Boolean)
          .map(String)
      : [],

    mpn,

    oem_number: oemNumber,

    price: minPrice,

    max_price: maxPrice,

    currency,

    // Product-level availability:
    //
    // At least one available variant = In Stock
    availability,

    // ONLY collection IDs here.
    collections: collectionIds,

    featured_image_url:
      product.featuredImage || null,

    media_urls: Array.isArray(product.media)
      ? product.media
          .filter(Boolean)
          .map(String)
      : [],

    variants: normalizedVariants,

    custom_fields: customFields,

    sort_order: 0,
  };
}