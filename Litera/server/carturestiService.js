import httpClient from "./httpClient.js";
import decodeHtmlEntities from "../utils/decodeHtmlEntities.js";

const searchCache = new Map();
const detailsCache = new Map();
const SEARCH_TTL_MS = 5 * 60 * 1000;
const DETAILS_TTL_MS = 15 * 60 * 1000;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export async function searchCarturesti(query, maxFetchPages = 10) {
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
  const searchPageUrl = `https://carturesti.md/product/search/${encodedQuery}?stock_label=in-stoc%7Cstoc-limitat&limba=Rusa&page=1`;

  try {
    const initRes = await httpClient.get(searchPageUrl, {
      headers: BASE_HEADERS,
      timeout: 8000,
    });

    const cookies =
      initRes.headers["set-cookie"]
        ?.map((c) => c.split(";")[0])
        .join("; ") || "";

    const csrfMatch = initRes.data.match(
      /<meta\s+name="csrf-token"\s+content="([^"]+)"/i,
    );
    const csrfToken = csrfMatch ? csrfMatch[1] : "";

    const postHeaders = {
      ...BASE_HEADERS,
      "Content-Type": "application/json;charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/plain, */*",
      "X-CSRF-Token": csrfToken,
      Cookie: cookies,
      Referer: searchPageUrl,
    };

    const fetchPage = async (page) => {
      const payload = {
        settings: {
          context: "search",
          contextId: query,
          url: "/product/json-search",
          term: query,
          listName: "Search page",
        },
        attributes: [],
        preferences: [],
        search: {
          stock_label: "in-stoc|stoc-limitat",
          limba: "Rusa",
          page,
        },
      };

      try {
        const res = await httpClient.post(
          "https://carturesti.md/product/json-search",
          payload,
          {
            headers: postHeaders,
            timeout: 8000,
          },
        );
        return res.data;
      } catch {
        return null;
      }
    };

    const page1Data = await fetchPage(1);
    if (!page1Data?.products) {
      return [];
    }

    const pageNumbers = [
      ...(page1Data.pagination || "").matchAll(/(?:[?&]|&amp;)page=(\d+)/g),
    ].map((m) => Number(m[1]));
    const dataPages = [
      ...(page1Data.pagination || "").matchAll(/data-page="(\d+)"/g),
    ].map((m) => Number(m[1]) + 1);
    const allPageNums = [...pageNumbers, ...dataPages];
    const maxPage = allPageNums.length
      ? Math.min(Math.max(...allPageNums), maxFetchPages)
      : 1;

    let rawProducts = [...(page1Data.products || [])];

    if (maxPage > 1) {
      const pagePromises = [];
      for (let p = 2; p <= maxPage; p++) {
        pagePromises.push(fetchPage(p));
      }
      const results = await Promise.all(pagePromises);
      for (const res of results) {
        if (Array.isArray(res?.products)) {
          rawProducts.push(...res.products);
        }
      }
    }

    const normalized = [];
    const seenUrls = new Set();

    for (const item of rawProducts) {
      if (!item?.name) continue;
      const cleanPath = (item.url || "").split("?")[0];
      const productUrl = cleanPath.startsWith("http")
        ? cleanPath
        : `https://carturesti.md${cleanPath}`;

      if (seenUrls.has(productUrl)) continue;
      seenUrls.add(productUrl);

      const price = item.price ? String(item.price) : "";
      const rawImg = item.imgUrl || "";
      const imgUrl = rawImg.replace(
        /(\/img-prod\/\d+(?:-\d+)?)-\d{3,4}\.(jpe?g|png|webp)(\?.*)?$/i,
        "$1.$2$3",
      );
      const rawAuthor = item.subtitle
        ? item.subtitle.replace(/<[^>]+>/g, "").trim()
        : "";

      normalized.push({
        url: productUrl,
        name: decodeHtmlEntities(item.name),
        price,
        author: decodeHtmlEntities(rawAuthor),
        mainImage: { url: imgUrl },
        images: [{ url: imgUrl }],
      });
    }

    searchCache.set(cacheKey, {
      data: normalized,
      expiresAt: Date.now() + SEARCH_TTL_MS,
    });

    return normalized;
  } catch (error) {
    console.warn("Carturesti search error:", error.message);
    return [];
  }
}

export async function getCarturestiDetails(bookUrl) {
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
        jsonLd = JSON.parse(match[1]);
      } catch {
        // Fallback
      }
    }

    const title = decodeHtmlEntities(
      jsonLd?.name ||
      html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ||
      "",
    );
    const price =
      jsonLd?.offers?.price ||
      html.match(/class="[^"]*pret[^"]*"[^>]*>([^<]+)</i)?.[1]?.replace(/[^\d.]/g, "") ||
      "";
    const rawImage =
      jsonLd?.image ||
      html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ||
      "";
    const image = rawImage.replace(
      /(\/img-prod\/\d+(?:-\d+)?)-\d{3,4}\.(jpe?g|png|webp)(\?.*)?$/i,
      "$1.$2$3",
    );
    const description = decodeHtmlEntities(
      jsonLd?.description ||
      html.match(/<meta property="og:description" content="([^"]+)"/i)?.[1] ||
      "",
    );

    const additionalProperties = [];
    if (jsonLd?.brand?.name) {
      additionalProperties.push({
        name: "издательство",
        value: decodeHtmlEntities(jsonLd.brand.name),
      });
    }
    if (jsonLd?.GTIN13 || jsonLd?.isbn) {
      additionalProperties.push({
        name: "isbn",
        value: String(jsonLd.GTIN13 || jsonLd.isbn),
      });
    }

    // Extract author if present
    const authorMatch = html.match(
      /<a[^>]+href="\/autor\/[^"]*"[^>]*>([^<]+)<\/a>/i,
    );
    if (authorMatch) {
      additionalProperties.push({
        name: "автор",
        value: decodeHtmlEntities(authorMatch[1].trim()),
      });
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
    console.warn("Carturesti details error:", error.message);
    return null;
  }
}
