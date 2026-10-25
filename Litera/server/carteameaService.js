import httpClient from "./httpClient.js";
import decodeHtmlEntities from "../utils/decodeHtmlEntities.js";

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

export function decodeCarteameaImage(url) {
  if (!url || typeof url !== "string") return "";
  // Strip WordPress image dimension suffixes like -150x225.jpg to get the original high-resolution cover
  return url.replace(/-\d+x\d+\.(jpe?g|png|webp)(\?.*)?$/i, ".$1$2");
}

export function parseCarteameaHtml(html) {
  const cards = [
    ...html.matchAll(/<li[^>]+class="[^"]*type-product[^"]*"[\s\S]*?<\/li>/gi),
  ].map((m) => m[0]);
  const products = [];

  for (const card of cards) {
    // 1. Exclude products without covers (placeholders / no photo)
    if (
      card.includes("woocommerce-placeholder") ||
      card.includes('alt="Заполнитель"') ||
      card.includes("placeholder")
    ) {
      continue;
    }

    // Extract image tag and src
    const imgMatch = card.match(/<img[^>]+src="([^"]+)"/i);
    const rawSrc = imgMatch ? imgMatch[1] : "";
    if (!rawSrc || rawSrc.includes("placeholder")) {
      continue;
    }

    // Inspect srcset for largest candidate
    const srcsetMatch = card.match(/srcset="([^"]+)"/i);
    let bestImg = rawSrc;
    if (srcsetMatch) {
      const candidates = srcsetMatch[1]
        .split(",")
        .map((s) => s.trim().split(/\s+/));
      let maxWidth = 0;
      for (const [candUrl, candWidth] of candidates) {
        const w = candWidth ? parseInt(candWidth.replace(/\D/g, ""), 10) : 0;
        if (w > maxWidth) {
          maxWidth = w;
          bestImg = candUrl;
        }
      }
    }

    // Strip thumbnail suffix to get full-res original
    const fullImg = decodeCarteameaImage(bestImg);

    // Extract product URL
    const urlMatch =
      card.match(
        /<div class="woocommerce-loop-product__title">\s*<a[^>]+href="([^"]+)"/i,
      ) ||
      card.match(
        /<a[^>]+class="[^"]*woocommerce-LoopProduct-link[^"]*"[^>]+href="([^"]+)"/i,
      );
    const productUrl = urlMatch ? urlMatch[1].trim() : "";
    if (!productUrl) continue;

    // Extract title & author
    const tb = card.match(
      /<div class="woocommerce-loop-product__title">([\s\S]*?)<\/div>/i,
    );
    let title = "";
    let author = "";
    if (tb) {
      const closeA = tb[1].indexOf("</a>");
      if (closeA !== -1) {
        const openAEnd = tb[1].lastIndexOf(">", closeA);
        const inner = openAEnd !== -1 ? tb[1].slice(openAEnd + 1, closeA) : "";
        const authorMatch =
          inner.match(/<b>(.*?)<\/b>/i) ||
          card.match(/aria-label="<b>(.*?)<\/b>/i);
        if (authorMatch && authorMatch[1].trim()) {
          author = authorMatch[1].replace(/<[^>]+>/g, "").trim();
        }
        title = decodeHtmlEntities(
          inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        );
      }
    }

    if (!title) {
      const fallbackTitleMatch = card.match(/aria-label="([^"]+)"/i);
      if (fallbackTitleMatch) {
        title = decodeHtmlEntities(
          fallbackTitleMatch[1]
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        );
      }
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

const page1Inflight = new Map();

export async function searchCarteamea(query, maxFetchPages = 10) {
  const normQuery = query.trim().toLowerCase();
  const cacheKey = `${normQuery}::${maxFetchPages}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  const fullCached = searchCache.get(`${normQuery}::10`);
  if (fullCached && Date.now() < fullCached.expiresAt) {
    return fullCached.data;
  }

  const encodedQuery = encodeURIComponent(query);
  const getPageUrl = (page) =>
    page <= 1
      ? `https://carteamea.md/?lang=ru&s=${encodedQuery}&search_id=product&post_type=product`
      : `https://carteamea.md/page/${page}/?lang=ru&s=${encodedQuery}&search_id=product&post_type=product`;

  const fetchPage = async (page) => {
    try {
      const res = await httpClient.get(getPageUrl(page), {
        headers: BASE_HEADERS,
        timeout: 8000,
      });
      return res.data;
    } catch {
      return "";
    }
  };

  try {
    let p1Entry = page1Inflight.get(normQuery);
    if (!p1Entry || Date.now() >= p1Entry.expiresAt) {
      p1Entry = {
        promise: fetchPage(1),
        expiresAt: Date.now() + 30000,
      };
      page1Inflight.set(normQuery, p1Entry);
    }
    const page1Html = await p1Entry.promise;
    if (!page1Html) return [];

    const page1Products = parseCarteameaHtml(page1Html);

    // Extract max page from pagination
    const pageNumbers = [
      ...page1Html.matchAll(/class=["']page-numbers["'][^>]*>(\d+)<\/a>/g),
      ...page1Html.matchAll(/\/page\/(\d+)\//g),
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
          allProducts.push(...parseCarteameaHtml(html));
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
    console.warn("Carteamea search error:", error.message);
    return [];
  }
}

export async function getCarteameaDetails(bookUrl) {
  const cached = detailsCache.get(bookUrl);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    const res = await httpClient.get(bookUrl, {
      headers: BASE_HEADERS,
      timeout: 8000,
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
      html.match(/<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ||
      html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ||
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
      jsonLd?.image ||
      html.match(
        /class="woocommerce-product-gallery__image"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i,
      )?.[1] ||
      html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ||
      "";
    const image = decodeCarteameaImage(rawImage);

    const rawDescription =
      jsonLd?.description ||
      html.match(/id="tab-description"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      html.match(
        /class="woocommerce-product-details__short-description"[^>]*>([\s\S]*?)<\/div>/i,
      )?.[1] ||
      "";
    const description = decodeHtmlEntities(
      rawDescription.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );

    const additionalProperties = [];

    // Author
    const authorMatch =
      rawTitle.match(/<b>(.*?)<\/b>/i) ||
      html.match(/<b>(.*?)<\/b>/i);
    if (authorMatch && authorMatch[1].trim()) {
      additionalProperties.push({
        name: "автор",
        value: decodeHtmlEntities(authorMatch[1].replace(/<[^>]+>/g, "").trim()),
      });
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

    const product = {
      name: title,
      price,
      currency: "MDL",
      description,
      availability:
        jsonLd?.offers?.[0]?.availability?.includes("InStock") ||
        jsonLd?.offers?.availability?.includes("InStock") ||
        !html.includes("out-of-stock")
          ? "InStock"
          : "OutOfStock",
      mainImage: { url: image },
      images: [{ url: image }],
      additionalProperties,
      brand: { name: "carteamea.md" },
    };

    detailsCache.set(bookUrl, {
      data: product,
      expiresAt: Date.now() + DETAILS_TTL_MS,
    });

    return product;
  } catch (error) {
    console.warn("Carteamea details error:", error.message);
    return null;
  }
}
