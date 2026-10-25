import httpClient from "./httpClient.js";
import decodeHtmlEntities from "../utils/decodeHtmlEntities.js";

const searchCache = new Map();
const detailsCache = new Map();
const SEARCH_TTL_MS = 5 * 60 * 1000;
const DETAILS_TTL_MS = 15 * 60 * 1000;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Connection": "close",
};

export function parseUlyssesHtml(html) {
  const cards = html.split('<div class="catalog_item_wrapp').slice(1);
  const products = [];

  for (const card of cards) {
    const titleMatch = card.match(
      /<div class="item-title">\s*<a[^>]*>\s*<span>([^<]+)<\/span>/i,
    );
    const hrefMatch = card.match(/<div class="item-title">\s*<a href="([^"]+)"/i);
    const priceMatch =
      card.match(/<div class="price"[^>]*data-value="([^"]+)"/i) ||
      card.match(/<span class="price_value">([^<]+)<\/span>/i);
    const imgMatch = card.match(/<img[^>]+src="([^"]+)"/i);

    if (titleMatch && hrefMatch) {
      const name = decodeHtmlEntities(titleMatch[1]);
      const rawHref = hrefMatch[1].trim();
      const url = rawHref.startsWith("http")
        ? rawHref
        : `https://www.ulysses.md${rawHref}`;

      let price = "";
      if (priceMatch) {
        const val = Number.parseFloat(priceMatch[1]);
        if (Number.isFinite(val)) {
          price = val.toFixed(2);
        } else {
          price = priceMatch[1].replace(/[^\d.]/g, "");
        }
      }

      let imgUrl = "";
      if (imgMatch && !imgMatch[1].includes("no_photo")) {
        imgUrl = imgMatch[1].startsWith("http")
          ? imgMatch[1]
          : `https://www.ulysses.md${imgMatch[1]}`;
        if (imgUrl.includes("/resize_cache/iblock/")) {
          imgUrl = imgUrl.replace(
            /\/resize_cache\/iblock\/([^/]+)\/[^/]+\/([^/]+)$/,
            "/iblock/$1/$2",
          );
        }
      }

      if (imgUrl) {
        products.push({
          url,
          name,
          price,
          mainImage: { url: imgUrl },
          images: [{ url: imgUrl }],
        });
      }
    }
  }

  return products;
}

export const highResCache = new Map();
export const thumbToHighRes = new Map();

export async function resolveHighResImage(productUrl, fallbackImg) {
  if (!productUrl || productUrl.includes("no_photo")) return fallbackImg;
  if (highResCache.has(productUrl)) {
    return highResCache.get(productUrl);
  }
  try {
    const res = await httpClient.get(productUrl, {
      headers: BASE_HEADERS,
      family: 4,
      timeout: 3500,
    });
    const html = res.data;
    const sliderMatch =
      html.match(
        /<div[^>]+class="item_slider"[\s\S]*?<a[^>]+href="([^"]+)"/i,
      ) ||
      html.match(
        /<a[^>]+href="(\/upload\/iblock\/[^"]+)"[^>]+class="fancy"/i,
      );
    const detailImg = html.match(
      /class="detail-gallery"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i,
    );
    let image = sliderMatch?.[1] || detailImg?.[1] || "";
    if (image && !image.startsWith("http")) {
      image = `https://www.ulysses.md${image}`;
    }
    const finalImg = image || fallbackImg;
    highResCache.set(productUrl, finalImg);
    if (fallbackImg && finalImg && finalImg !== fallbackImg) {
      thumbToHighRes.set(fallbackImg, finalImg);
    }
    return finalImg;
  } catch {
    return fallbackImg;
  }
}

const page1Inflight = new Map();

export async function searchUlysses(query, maxFetchPages = 6) {
  const normQuery = query.trim().toLowerCase();
  const cacheKey = `${normQuery}::${maxFetchPages}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  const fullCached = searchCache.get(`${normQuery}::6`);
  if (fullCached && Date.now() < fullCached.expiresAt) {
    return fullCached.data;
  }

  const encodedQuery = encodeURIComponent(query);
  const getPageUrl = (page) =>
    `https://www.ulysses.md/catalog/?display=block&q=${encodedQuery}&how=r&PAGEN_2=${page}`;

  const fetchPage = async (page) => {
    try {
      const res = await httpClient.get(getPageUrl(page), {
        headers: BASE_HEADERS,
        family: 4,
        timeout: 6000,
      });
      return res.data;
    } catch {
      return "";
    }
  };

  const getPage1Html = () => {
    const existing = page1Inflight.get(normQuery);
    if (existing && Date.now() < existing.expiresAt) {
      return existing.promise;
    }
    const promise = fetchPage(1);
    page1Inflight.set(normQuery, {
      promise,
      expiresAt: Date.now() + 30000,
    });
    return promise;
  };

  try {
    const page1Html = await getPage1Html();
    if (!page1Html) return [];

    const page1Products = parseUlyssesHtml(page1Html);
    const pageNumbers = [
      ...page1Html.matchAll(/[?&;]PAGEN_2=(\d+)/g),
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
          allProducts.push(...parseUlyssesHtml(html));
        }
      }
    }

    const seenUrls = new Set();
    const uniqueProducts = allProducts.filter((p) => {
      if (!p.url || seenUrls.has(p.url)) return false;
      seenUrls.add(p.url);
      return true;
    });

    // Sort uniqueProducts by query relevance first
    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scoreProduct = (p) => {
      const name = (p.name || "").toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        if (name === token) score += 100;
        else if (name.startsWith(token)) score += 50;
        else if (name.includes(token)) score += 20;
      }
      return score;
    };
    uniqueProducts.sort((a, b) => scoreProduct(b) - scoreProduct(a));

    // Apply any already-cached high-res overrides synchronously, and warm the rest in the background
    for (const p of uniqueProducts) {
      const cachedHighRes = highResCache.get(p.url);
      if (cachedHighRes) {
        p.mainImage = { url: cachedHighRes };
        p.images = [{ url: cachedHighRes }];
      }
    }

    if (maxFetchPages > 1) {
      const toWarm = uniqueProducts.slice(0, 24);
      Promise.all(
        toWarm.map(async (p) => {
          const highRes = await resolveHighResImage(p.url, p.mainImage?.url);
          if (highRes) {
            p.mainImage = { url: highRes };
            p.images = [{ url: highRes }];
          }
        }),
      ).catch(() => {});
    }

    searchCache.set(cacheKey, {
      data: uniqueProducts,
      expiresAt: Date.now() + SEARCH_TTL_MS,
    });

    return uniqueProducts;
  } catch (error) {
    console.warn("Ulysses search error:", error.message);
    return [];
  }
}

export async function getUlyssesDetails(bookUrl) {
  const cached = detailsCache.get(bookUrl);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    const res = await httpClient.get(bookUrl, {
      headers: BASE_HEADERS,
      family: 4,
      timeout: 8000,
    });

    const html = res.data;
    const ogTitle = html.match(
      /<meta property="og:title" content="([^"]+)"/i,
    );
    const h1Title = html.match(/<h1[^>]*id="pagetitle"[^>]*>([^<]+)<\/h1>/i) ||
                    html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const rawTitle =
      h1Title?.[1]?.trim() ||
      ogTitle?.[1]?.replace(/ купить онлайн.*$/i, "").replace(/^Книга\s+[«"]?([^»"]+)[»"]?/i, "$1") ||
      "";
    const title = decodeHtmlEntities(rawTitle);

    const sliderMatch =
      html.match(
        /<div[^>]+class="item_slider"[\s\S]*?<a[^>]+href="([^"]+)"/i,
      ) ||
      html.match(
        /<a[^>]+href="(\/upload\/iblock\/[^"]+)"[^>]+class="fancy"/i,
      );
    const detailImg = html.match(
      /class="detail-gallery"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i,
    );
    const ogImage = html.match(
      /<meta property="og:image" content="([^"]+)"/i,
    );
    let image = sliderMatch?.[1] || detailImg?.[1] || ogImage?.[1] || "";
    if (image && !image.startsWith("http")) {
      image = `https://www.ulysses.md${image}`;
    }
    if (image) {
      highResCache.set(bookUrl, image);
    }

    const priceMatch =
      html.match(/<div class="price"[^>]*data-value="([^"]+)"/i) ||
      html.match(/<span class="price_value">([^<]+)<\/span>/i);
    let price = "";
    if (priceMatch) {
      const val = Number.parseFloat(priceMatch[1]);
      price = Number.isFinite(val) ? val.toFixed(2) : priceMatch[1].replace(/[^\d.]/g, "");
    }

    const descMatch = html.match(/class="detail_text"[^>]*>([\s\S]*?)<\/div>/i);
    const rawDescription = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : "";
    const description = decodeHtmlEntities(rawDescription);

    const additionalProperties = [];
    const propMatches = [
      ...html.matchAll(
        /class="char_name"[^>]*>([\s\S]*?)<\/div>[\s\S]*?class="char_value"[^>]*>([\s\S]*?)<\/div>/gi,
      ),
    ];

    for (const [, nameHtml, valHtml] of propMatches) {
      const name = decodeHtmlEntities(
        nameHtml.replace(/<[^>]+>/g, "").trim().toLowerCase(),
      );
      const val = decodeHtmlEntities(valHtml.replace(/<[^>]+>/g, "").trim());
      if (name && val) {
        additionalProperties.push({ name, value: val });
      }
    }

    const product = {
      name: title,
      price,
      currency: "MDL",
      description,
      availability: "InStock",
      mainImage: { url: image },
      images: [{ url: image }],
      additionalProperties,
    };

    detailsCache.set(bookUrl, {
      data: product,
      expiresAt: Date.now() + DETAILS_TTL_MS,
    });

    return product;
  } catch (error) {
    console.warn("Ulysses details error:", error.message);
    return null;
  }
}
