import httpClient from "./httpClient.js";
import decodeHtmlEntities from "../utils/decodeHtmlEntities.js";
import extractBookMetadata from "../utils/extractBookMetadata.js";

const searchCache = new Map();
const detailsCache = new Map();
const SEARCH_TTL_MS = 5 * 60 * 1000;
const DETAILS_TTL_MS = 15 * 60 * 1000;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
};

export function decodeBiblionImage(url) {
  if (!url || typeof url !== "string") return "";
  // Strip WordPress image dimension suffixes like -350x350.avif to get the original high-resolution cover
  return url.replace(/-\d+x\d+\.(avif|jpe?g|png|webp)(\?.*)?$/i, ".$1$2");
}

export function parseBiblionHtml(html) {
  const cards = [
    ...html.matchAll(
      /<li[^>]+class="[^"]*(?:product\s|type-product)[^"]*"[\s\S]*?<\/li>/gi,
    ),
  ].map((m) => m[0]);
  const products = [];

  for (const card of cards) {
    // 1. Exclude products without covers (placeholders / no photo)
    if (
      card.includes("placeholder.png") &&
      !card.includes("data-src=") &&
      !card.includes("data-srcset=")
    ) {
      continue;
    }

    // Extract image tag and candidate sources
    let rawSrc = "";
    const dataSrcMatch = card.match(/data-src="([^"]+)"/i);
    const dataSrcsetMatch = card.match(/data-srcset="([^"]+)"/i);
    const srcMatch = card.match(/src="([^"]+)"/i);

    if (dataSrcsetMatch) {
      const candidates = dataSrcsetMatch[1]
        .split(",")
        .map((s) => s.trim().split(/\s+/));
      let maxWidth = 0;
      for (const [candUrl, candWidth] of candidates) {
        const w = candWidth ? parseInt(candWidth.replace(/\D/g, ""), 10) : 0;
        if (w > maxWidth && !candUrl.includes("placeholder")) {
          maxWidth = w;
          rawSrc = candUrl;
        }
      }
    }

    if (!rawSrc && dataSrcMatch && !dataSrcMatch[1].includes("placeholder")) {
      rawSrc = dataSrcMatch[1];
    }
    if (!rawSrc && srcMatch && !srcMatch[1].includes("placeholder")) {
      rawSrc = srcMatch[1];
    }

    if (!rawSrc || rawSrc.includes("placeholder")) {
      continue;
    }

    // Strip thumbnail dimension suffixes to get the full-res original
    const fullImg = decodeBiblionImage(rawSrc);

    // Extract product URL
    const urlMatch =
      card.match(
        /<h3[^>]*class="[^"]*woocommerce-loop-product__title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i,
      ) ||
      card.match(
        /<a[^>]+href="([^"]+)"[^>]*class="[^"]*woocommerce-LoopProduct-link/i,
      );
    const productUrl = urlMatch ? urlMatch[1].trim() : "";
    if (!productUrl) continue;

    // Extract title
    const titleMatch = card.match(
      /<h3[^>]*class="[^"]*woocommerce-loop-product__title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    );
    let title = "";
    if (titleMatch) {
      title = decodeHtmlEntities(
        titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      );
    }
    if (!title) continue;

    // Extract price
    const priceMatch =
      card.match(/<bdi>([\d.,\s]+)&nbsp;/i) ||
      card.match(/class="[^"]*amount[^"]*"[^>]*>([\d.,\s]+)/i);
    let price = "";
    if (priceMatch) {
      price = priceMatch[1].replace(/\s+/g, "").replace(",", ".");
    }

    // Extract author if available in title or gtm data
    let author = "";
    const gtmMatch = card.match(/data-gtm4wp_product_data="([^"]+)"/i);
    if (gtmMatch) {
      try {
        const gtmData = JSON.parse(decodeHtmlEntities(gtmMatch[1]));
        if (gtmData.item_brand) author = gtmData.item_brand;
      } catch {
        // ignore
      }
    }

    products.push({
      url: productUrl,
      name: title,
      author: decodeHtmlEntities(author),
      price,
      currency: "MDL",
      mainImage: { url: fullImg },
      images: [{ url: fullImg }],
    });
  }

  return products;
}

export async function searchBiblion(query, maxFetchPages = 10) {
  const cacheKey = `${query.trim().toLowerCase()}::${maxFetchPages}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const encodedQuery = encodeURIComponent(query);
  const getPageUrl = (page) =>
    page <= 1
      ? `https://biblion.md/shop/?s=${encodedQuery}&post_type=product&dgwt_wcas=1`
      : `https://biblion.md/shop/page/${page}/?s=${encodedQuery}&post_type=product&dgwt_wcas=1`;

  const fetchPage = async (page) => {
    try {
      const res = await httpClient.get(getPageUrl(page), {
        headers: BASE_HEADERS,
        timeout: 5000,
      });
      return res.data;
    } catch {
      return "";
    }
  };

  try {
    const page1Html = await fetchPage(1);
    if (!page1Html) return [];

    const page1Products = parseBiblionHtml(page1Html);

    // Extract max page from pagination
    const pageNumbers = [
      ...page1Html.matchAll(/class=["']page-numbers["'][^>]*>(\d+)<\/a>/g),
      ...page1Html.matchAll(/\/page\/(\d+)\//g),
      ...page1Html.matchAll(/aria-label=["']Страница (\d+)["']/g),
    ].map((m) => Number(m[1]));

    const maxPage = pageNumbers.length
      ? Math.min(Math.max(...pageNumbers), maxFetchPages)
      : 1;

    let allProducts = [...page1Products];

    if (maxPage > 1) {
      const pagePromises = [];
      for (let p = 2; p <= maxPage; p++) {
        pagePromises.push(fetchPage(p));
      }
      const results = await Promise.all(pagePromises);
      for (const html of results) {
        if (html) {
          allProducts.push(...parseBiblionHtml(html));
        }
      }
    }

    // Deduplicate by URL
    const seenUrls = new Set();
    const uniqueProducts = allProducts.filter((p) => {
      if (!p.url || seenUrls.has(p.url)) return false;
      seenUrls.add(p.url);
      return true;
    });

    searchCache.set(cacheKey, {
      data: uniqueProducts,
      expiresAt: Date.now() + SEARCH_TTL_MS,
    });

    return uniqueProducts;
  } catch (error) {
    console.warn("Biblion search error:", error.message);
    return [];
  }
}

export async function getBiblionDetails(bookUrl) {
  const cached = detailsCache.get(bookUrl);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    const res = await httpClient.get(bookUrl, {
      headers: BASE_HEADERS,
      timeout: 9000,
    });

    const html = res.data;
    let jsonLd = null;
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i,
    );
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed?.["@graph"])) {
          jsonLd =
            parsed["@graph"].find((item) => item["@type"] === "Product") ||
            parsed["@graph"][0];
        } else {
          jsonLd = parsed;
        }
      } catch {
        // Fallback
      }
    }

    const rawTitle =
      jsonLd?.name ||
      html.match(
        /<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
      )?.[1]?.trim() ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.trim() ||
      "";
    const title = decodeHtmlEntities(rawTitle)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const price =
      jsonLd?.offers?.[0]?.price ||
      jsonLd?.offers?.price ||
      html
        .match(/class="[^"]*price[^"]*"[^>]*>[\s\S]*?<bdi>([^<]+)/i)?.[1]
        ?.replace(/[^\d.]/g, "")
        ?.replace(",", ".") ||
      "";

    const rawImage =
      html.match(
        /class="woocommerce-product-gallery__image"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i,
      )?.[1] ||
      jsonLd?.image ||
      html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ||
      "";
    const image = decodeBiblionImage(rawImage);

    const rawDescription =
      jsonLd?.description ||
      html.match(/id="tab-description"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      html.match(
        /class="woocommerce-product-details__short-description"[^>]*>([\s\S]*?)<\/div>/i,
      )?.[1] ||
      "";
    const initialDesc = decodeHtmlEntities(
      rawDescription.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );

    const { cleanDescription, extracted } = extractBookMetadata(initialDesc);
    const description = cleanDescription;

    const additionalProperties = [];

    // Parse attributes from woocommerce-product-attributes table
    const attrRows = [
      ...html.matchAll(
        /<tr[^>]*class="[^"]*woocommerce-product-attributes-item[^"]*"[\s\S]*?<\/tr>/gi,
      ),
    ].map((m) => m[0]);

    for (const row of attrRows) {
      const labelMatch = row.match(
        /<th[^>]*class="[^"]*woocommerce-product-attributes-item__label[^"]*"[^>]*>([\s\S]*?)<\/th>/i,
      );
      const valueMatch = row.match(
        /<td[^>]*class="[^"]*woocommerce-product-attributes-item__value[^"]*"[^>]*>([\s\S]*?)<\/td>/i,
      );
      if (labelMatch && valueMatch) {
        let label = decodeHtmlEntities(
          labelMatch[1].replace(/<[^>]+>/g, "").trim(),
        );
        // Clean unicode escape artifacts like u0410u0432u0442u043eu0440 -> Автор
        if (/u04[0-9a-f]{2}/i.test(label)) {
          label = label.replace(/u([0-9a-f]{4})/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        }
        const val = decodeHtmlEntities(
          valueMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        );
        if (label && val) {
          additionalProperties.push({
            name: label.toLowerCase(),
            value: val,
          });
        }
      }
    }

    // Categories
    const categories = [
      ...html.matchAll(
        /<span class="posted_in">[\s\S]*?rel="tag">([^<]+)<\/a>/gi,
      ),
    ].map((m) => m[1].trim());
    if (categories.length > 0) {
      additionalProperties.push({
        name: "жанр",
        value: decodeHtmlEntities(categories.join(", ")),
      });
    }

    // Merge extracted metadata from description (publisher, binding, author, series, pages, code, genre)
    if (
      extracted?.publisher &&
      !additionalProperties.some((p) => /издательств/i.test(p.name))
    ) {
      additionalProperties.push({
        name: "издательство",
        value: extracted.publisher,
      });
    }
    if (
      extracted?.binding &&
      !additionalProperties.some((p) => /переплет|обложк/i.test(p.name))
    ) {
      additionalProperties.push({
        name: "переплет",
        value: extracted.binding,
      });
    }
    if (
      extracted?.author &&
      !additionalProperties.some((p) => /автор/i.test(p.name))
    ) {
      additionalProperties.push({
        name: "автор",
        value: extracted.author,
      });
    }
    if (
      extracted?.series &&
      !additionalProperties.some((p) => /серия/i.test(p.name))
    ) {
      additionalProperties.push({
        name: "серия",
        value: extracted.series,
      });
    }
    if (
      extracted?.pages &&
      !additionalProperties.some((p) => /страниц/i.test(p.name))
    ) {
      additionalProperties.push({
        name: "количество страниц",
        value: extracted.pages,
      });
    }
    if (
      extracted?.genre &&
      !additionalProperties.some((p) => /жанр/i.test(p.name))
    ) {
      additionalProperties.push({
        name: "жанр",
        value: extracted.genre,
      });
    }

    const product = {
      name: title,
      author: extracted?.author || undefined,
      price,
      currency: "MDL",
      description,
      availability:
        jsonLd?.offers?.[0]?.availability?.includes("InStock") ||
        jsonLd?.offers?.availability?.includes("InStock") ||
        html.includes("instock") ||
        !html.includes("out-of-stock")
          ? "InStock"
          : "OutOfStock",
      mainImage: { url: image },
      images: [{ url: image }],
      additionalProperties,
      brand: { name: "biblion.md" },
    };

    detailsCache.set(bookUrl, {
      data: product,
      expiresAt: Date.now() + DETAILS_TTL_MS,
    });

    return product;
  } catch (error) {
    console.warn("Biblion details error:", error.message);
    return null;
  }
}
