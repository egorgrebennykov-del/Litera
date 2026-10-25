import httpClient from "./httpClient.js";
import decodeHtmlEntities from "../utils/decodeHtmlEntities.js";

const searchCache = new Map();
const detailsCache = new Map();
const SEARCH_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DETAILS_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function decodeLibrariusImage(url) {
  if (!url) return "";
  let target = url;
  if (target.includes("/img/catalog/")) {
    target = target.replace("/img/catalog/", "/img/original/");
  }
  try {
    const match = target.match(/\/img\/\d+\/\d+\/(?:x)?([A-Za-z0-9_-]+)/);
    if (match) {
      let b64 = match[1].replace(/_e_/g, "=").replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4 !== 0) b64 += "=";
      const decoded =
        typeof atob === "function"
          ? atob(b64)
          : globalThis.Buffer?.from(b64, "base64").toString("utf8") ?? "";
      if (decoded.startsWith("http")) {
        return decoded
          .replace(/^http:/i, "https:")
          .replace("/img/catalog/", "/img/original/");
      }
    }
  } catch {
    // Ignore decoding errors and fallback to original URL
  }
  return target.replace(/^http:\/\/cdn\./, "https://cdn.");
}

export function parseLibrariusHtml(html) {
  const cards = html.split('<div class="anyproduct-card">').slice(1);
  const products = [];

  for (const card of cards) {
    const linkMatch = card.match(/<a\s+href="([^"]+)"/);
    const titleMatch = card.match(/<div class="card-title">([^<]+)<\/div>/);
    const priceMatch = card.match(/<div class="card-price">([^<]+)<\/div>/);
    const imgMatch = card.match(/<img[^>]+src="([^"]+)"/);

    if (linkMatch && titleMatch) {
      const url = linkMatch[1];
      const name = decodeHtmlEntities(titleMatch[1]);
      const price = priceMatch ? priceMatch[1] : "";
      const imgSrc = imgMatch ? imgMatch[1] : "";
      const fullImg = decodeLibrariusImage(imgSrc);

      products.push({
        url,
        name,
        price,
        mainImage: { url: fullImg },
        images: [{ url: fullImg }],
      });
    }
  }
  return products;
}

const page1Inflight = new Map();

export async function searchLibrarius(query, maxFetchPages = 10) {
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

  const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");
  const getPageUrl = (page) =>
    `https://librarius.md/ru/esearch/page/${page}?search=${encodedQuery}`;

  const fetchPage = async (page) => {
    try {
      const response = await httpClient.get(getPageUrl(page), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 5000,
      });
      return response.data;
    } catch {
      return "";
    }
  };

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

  const page1Products = parseLibrariusHtml(page1Html);
  const pageNumbers = [
    ...page1Html.matchAll(/\/ru\/esearch\/page\/(\d+)\?/g),
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
    const htmls = await Promise.all(pagePromises);
    for (const html of htmls) {
      if (html) {
        allProducts.push(...parseLibrariusHtml(html));
      }
    }
  }

  // Deduplicate products by URL
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
}

export function parseLibrariusDetails(html, pageUrl) {
  let jsonLd = null;
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      jsonLd = data.mainEntity || data;
    } catch {
      // Fallback if JSON-LD parse fails
    }
  }

  const rawTitle =
    jsonLd?.name ||
    html.match(/<h1[^>]*class="[^"]*book-title[^"]*"[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ||
    "";
  const title = decodeHtmlEntities(rawTitle);
  const rawAuthor =
    jsonLd?.author ||
    html.match(/class="book-prop-name">Автор<\/div>[\s\S]*?<div class="book-prop-value">([^<]+)<\/div>/i)?.[1]?.trim() ||
    "";
  const author = decodeHtmlEntities(rawAuthor);
  const price =
    jsonLd?.offers?.price ||
    html.match(/class="book-page-price">([^<]+)<\/div>/i)?.[1]?.replace(/[^\d.]/g, "") ||
    "";
  const isbn =
    jsonLd?.isbn ||
    html.match(/class="book-prop-name">ISBN<\/div>[\s\S]*?<div class="book-prop-value">([^<]+)<\/div>/i)?.[1]?.trim() ||
    "";
  const publisher = decodeHtmlEntities(
    jsonLd?.publisher ||
    html.match(/class="book-prop-name">Издательство<\/div>[\s\S]*?<div class="book-prop-value">([^<]+)<\/div>/i)?.[1]?.trim() ||
    "",
  );
  const pages =
    jsonLd?.numberOfPages ||
    html.match(/class="book-prop-name">Страницы<\/div>[\s\S]*?<div class="book-prop-value">([^<]+)<\/div>/i)?.[1]?.trim() ||
    "";
  const year =
    jsonLd?.datePublished?.slice(0, 4) ||
    html.match(/class="book-prop-name">Год<\/div>[\s\S]*?<div class="book-prop-value">([^<]+)<\/div>/i)?.[1]?.trim() ||
    "";

  // Description
  let description = "";
  const descSection = html.match(
    /<div[^>]*class="[^"]*book-page-description[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer|<\/section|<\/main)/i,
  );
  if (descSection) {
    description = descSection[1]
      .replace(/<div class="nav nav-tabs">[\s\S]*?<\/div>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/^[oо]писание[\s\r\n:]*/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (!description && jsonLd?.description) {
    description = String(jsonLd.description)
      .replace(/^[oо]писание[\s\r\n:]*/i, "")
      .trim();
  }
  description = decodeHtmlEntities(description);

  const additionalProperties = [];
  const seenProps = new Set();

  // 1. Extract properties directly from HTML book-prop-item rows (handles links <a> inside values)
  const propMatches = [
    ...html.matchAll(
      /class="book-prop-name">([^<]+)<\/div>[\s\S]*?<div class="book-prop-value">([\s\S]*?)<\/div>/gi,
    ),
  ];
  for (const m of propMatches) {
    const rawName = m[1].replace(/<[^>]+>/g, "").trim();
    const rawVal = m[2].replace(/<[^>]+>/g, "").trim();
    if (!rawName || !rawVal) continue;

    // Normalize Latin lookalikes to Cyrillic
    const normName = rawName
      .toLowerCase()
      .replace(/a/g, "а")
      .replace(/k/g, "к")
      .replace(/e/g, "е")
      .replace(/o/g, "о")
      .replace(/c/g, "с")
      .trim();

    // Group keys so "год" and "год издания", "страницы" and "количество страниц" never duplicate
    let groupKey = normName;
    if (/штрих|код/i.test(normName)) continue;
    if (/^год/i.test(normName)) groupKey = "год";
    else if (/страниц/i.test(normName)) groupKey = "страницы";
    else if (/^isbn/i.test(normName)) groupKey = "isbn";
    else if (/автор/i.test(normName)) groupKey = "автор";
    else if (/издательств/i.test(normName)) groupKey = "издательство";
    else if (/коллекци|сери/i.test(normName)) groupKey = "серия";

    if (seenProps.has(groupKey)) continue;
    seenProps.add(groupKey);

    additionalProperties.push({
      name: groupKey,
      value: decodeHtmlEntities(rawVal),
    });
  }

  // 2. Supplement missing core properties ONLY if not already found in HTML table
  if (author && !seenProps.has("автор")) {
    additionalProperties.unshift({ name: "автор", value: author });
    seenProps.add("автор");
  }
  if (publisher && !seenProps.has("издательство")) {
    additionalProperties.push({ name: "издательство", value: publisher });
    seenProps.add("издательство");
  }
  if (isbn && !seenProps.has("isbn")) {
    additionalProperties.push({ name: "isbn", value: isbn });
    seenProps.add("isbn");
  }
  if (pages && !seenProps.has("страницы")) {
    additionalProperties.push({ name: "страницы", value: pages });
    seenProps.add("страницы");
  }
  if (year && !seenProps.has("год")) {
    additionalProperties.push({ name: "год", value: year });
    seenProps.add("год");
  }

  let imageUrl = jsonLd?.image || "";
  if (!imageUrl) {
    const imgMatch = html.match(
      /class="[^"]*book-page-image[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i,
    );
    imageUrl = imgMatch ? imgMatch[1] : "";
  }
  imageUrl = decodeLibrariusImage(imageUrl);

  return {
    name: title,
    url: pageUrl,
    price: String(price),
    currency: jsonLd?.offers?.priceCurrency || "MDL",
    availability: jsonLd?.offers?.availability?.includes("InStock")
      ? "InStock"
      : "OutOfStock",
    description,
    mainImage: { url: imageUrl },
    images: [{ url: imageUrl }],
    additionalProperties,
    brand: { name: "librarius.md" },
  };
}

export async function getLibrariusDetails(url) {
  const cached = detailsCache.get(url);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const response = await httpClient.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    timeout: 7000,
  });

  const details = parseLibrariusDetails(response.data, url);
  detailsCache.set(url, {
    data: details,
    expiresAt: Date.now() + DETAILS_TTL_MS,
  });

  return details;
}
