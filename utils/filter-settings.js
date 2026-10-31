import fs from "fs/promises";
import path from "path";
import { generateShopifyAccessToken } from "./access_token.js";

export async function getFilterSettings() {
  try {
    // Read filter settings from the project root.
    const settingsPath = path.join(
      process.cwd(),
      "filter-settings.json"
    );

    const settings = JSON.parse(
      await fs.readFile(settingsPath, "utf-8")
    );

    // Extract selected metafields.
    const selectedFilters = Object.entries(
      settings.included_metafields || {}
    ).map(([key, value]) => ({
      key,
      label: value.label,
      sort_order: value.sort_order,
    }));

    // Generate Shopify access token.
    const accessToken = await generateShopifyAccessToken();

    console.log("accessToken") 
    console.log(accessToken) 

    const url = `https://${process.env.SHOPIFY_STORE}/admin/api/${process.env.API_VERSION}/graphql.json`;

    const query = `
      query GetMetafieldDefinitions($first: Int!, $after: String) {
        metafieldDefinitions(
          ownerType: PRODUCT
          first: $first
          after: $after
        ) {
          nodes {
            key
            name
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const allAvailableFilters = [];
    let hasNextPage = true;
    let cursor = null;

    // Fetch every product metafield definition.
    while (hasNextPage) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query,
          variables: {
            first: 250,
            after: cursor,
          },
        }),
      });


    //   console.log(response)

      const result = await response.json();

      if (!response.ok || result.errors) {
        throw new Error(
          JSON.stringify(result.errors || result)
        );
      }

      const definitions =
        result.data.metafieldDefinitions;

      allAvailableFilters.push(
        ...definitions.nodes.map((item) => ({
          key: item.key,
          label: item.name,
        }))
      );

      hasNextPage = definitions.pageInfo.hasNextPage;
      cursor = definitions.pageInfo.endCursor;
    }

    return {
      selected_filters: selectedFilters,
      all_available_filters: allAvailableFilters,
    };
  } catch (error) {
    console.error("Failed to retrieve filter settings:", error);
    throw error;
  }
}

export async function saveFilterSettings(settings) {
  try {
    if (
      !settings ||
      typeof settings !== "object" ||
      Array.isArray(settings) ||
      !settings.included_metafields ||
      typeof settings.included_metafields !== "object" ||
      Array.isArray(settings.included_metafields)
    ) {
      throw new Error("Invalid settings structure.");
    }

    const includedMetafields = settings.included_metafields;

    // At least one metafield is required.
    if (Object.keys(includedMetafields).length === 0) {
      throw new Error(
        "At least one metafield must be included."
      );
    }

    // Validate each metafield.
    for (const [key, value] of Object.entries(includedMetafields)) {
      if (
        !key.trim() ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        throw new Error(`Invalid metafield entry: ${key}`);
      }

      if (
        typeof value.label !== "string" ||
        !value.label.trim()
      ) {
        throw new Error(`Invalid label for metafield: ${key}`);
      }

      if (
        !Number.isInteger(value.sort_order) ||
        value.sort_order < 1
      ) {
        throw new Error(`Invalid sort_order for metafield: ${key}`);
      }
    }

    const filePath = path.join(
      process.cwd(),
      "filter-settings.json"
    );

    await fs.writeFile(
      filePath,
      JSON.stringify(settings, null, 2),
      "utf-8"
    );

    return {
      success: true,
      message: "Filter settings saved successfully.",
    };
  } catch (error) {
    console.error("Failed to save filter settings:", error);
    throw error;
  }
}

getFilterSettings()

export async function getJustSavedSettings() {
  const settingsPath = path.join(
    process.cwd(),
    "filter-settings.json"
  );

  return JSON.parse(
    await fs.readFile(settingsPath, "utf-8")
  );
}