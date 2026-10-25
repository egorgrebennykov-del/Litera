import axios from "axios";
import enhancedImageUrl from "./enhancedImageUrl.js";
import decodeHtmlEntities from "./decodeHtmlEntities.js";
import extractBookMetadata from "./extractBookMetadata.js";

const ALLOWED_HOSTS = [
  "librarius.md",
  "carturesti.md",
  "ulysses.md",
  "carteamea.md",
  "biblion.md",
];

function isAllowed(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}

function normalizeProduct(product) {
  if (!product) return null;
  const rawImage =
    product.mainImage?.url ?? product.images?.[0]?.url ?? "";
  const fullImage = enhancedImageUrl(rawImage) || rawImage;

  let desc = decodeHtmlEntities(product.description ?? "").trim();
  // Strip redundant leading "Описание" / "Oписание" header if present
  desc = desc.replace(/^[oо]писание[\s\r\n:]*/i, "").trim();

  // If description was empty, check descriptionHtml
  if (!desc && product.descriptionHtml) {
    desc = product.descriptionHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/^[oо]писание[\s\r\n:]*/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const { cleanDescription, extracted } = extractBookMetadata(desc);
  const additionalProps = Array.isArray(product.additionalProperties)
    ? [...product.additionalProperties]
    : [];

  if (
    extracted?.publisher &&
    !additionalProps.some((p) => /издательств/i.test(p.name))
  ) {
    additionalProps.push({
      name: "издательство",
      value: extracted.publisher,
    });
  }
  if (
    extracted?.binding &&
    !additionalProps.some((p) => /переплет|обложк/i.test(p.name))
  ) {
    additionalProps.push({
      name: "переплет",
      value: extracted.binding,
    });
  }
  if (
    extracted?.author &&
    !additionalProps.some((p) => /автор/i.test(p.name))
  ) {
    additionalProps.push({
      name: "автор",
      value: extracted.author,
    });
  }
  if (
    extracted?.series &&
    !additionalProps.some((p) => /серия/i.test(p.name))
  ) {
    additionalProps.push({
      name: "серия",
      value: extracted.series,
    });
  }
  if (
    extracted?.pages &&
    !additionalProps.some((p) => /страниц/i.test(p.name))
  ) {
    additionalProps.push({
      name: "количество страниц",
      value: extracted.pages,
    });
  }
  if (
    extracted?.genre &&
    !additionalProps.some((p) => /жанр/i.test(p.name))
  ) {
    additionalProps.push({
      name: "жанр",
      value: extracted.genre,
    });
  }

  return {
    ...product,
    name: decodeHtmlEntities(product.name ?? ""),
    description: cleanDescription,
    author: product.author || extracted?.author || undefined,
    additionalProperties: additionalProps,
    mainImage: { url: fullImage },
    images: [{ url: fullImage }],
  };
}

const detailsCache = new Map();
const inFlightDetails = new Map();

export default async function getBookDetails(url) {
  if (!isAllowed(url)) return Promise.reject(new Error("Unsupported URL"));

  if (detailsCache.has(url)) {
    return detailsCache.get(url);
  }
  if (inFlightDetails.has(url)) {
    return inFlightDetails.get(url);
  }

  const promise = (async () => {
    // 1. Try fast local endpoint (typically ~350ms)
    try {
      const response = await axios.get(
        `/api/book-details?url=${encodeURIComponent(url)}`,
        { timeout: 5000 },
      );
      if (response.data?.product) {
        const normalized = normalizeProduct(response.data.product);
        if (normalized) detailsCache.set(url, normalized);
        return normalized;
      }
    } catch {
      // Fall back to direct in Node or Zyte
    }

    // 2. Direct fetch in Node / SSR environment
    if (typeof window === "undefined") {
      try {
        if (url.includes("librarius.md")) {
          const mod = ["..", "server", "librariusService.js"].join("/");
          const { getLibrariusDetails } = await import(/* @vite-ignore */ mod);
          const direct = await getLibrariusDetails(url);
          if (direct) return normalizeProduct(direct);
        } else if (url.includes("carturesti.md")) {
          const mod = ["..", "server", "carturestiService.js"].join("/");
          const { getCarturestiDetails } = await import(/* @vite-ignore */ mod);
          const direct = await getCarturestiDetails(url);
          if (direct) return normalizeProduct(direct);
        } else if (url.includes("ulysses.md")) {
          const mod = ["..", "server", "ulyssesService.js"].join("/");
          const { getUlyssesDetails } = await import(/* @vite-ignore */ mod);
          const direct = await getUlyssesDetails(url);
          if (direct) return normalizeProduct(direct);
        } else if (url.includes("carteamea.md")) {
          const mod = ["..", "server", "carteameaService.js"].join("/");
          const { getCarteameaDetails } = await import(/* @vite-ignore */ mod);
          const direct = await getCarteameaDetails(url);
          if (direct) return normalizeProduct(direct);
        } else if (url.includes("biblion.md")) {
          const mod = ["..", "server", "biblionService.js"].join("/");
          const { getBiblionDetails } = await import(/* @vite-ignore */ mod);
          const direct = await getBiblionDetails(url);
          if (direct) return normalizeProduct(direct);
        }
      } catch {
        // Fallback to Zyte
      }
    }

    // 3. Zyte extraction fallback
    const response = await axios.post(
      "https://api.zyte.com/v1/extract",
      {
        url,
        product: true,
        productOptions: { extractFrom: "httpResponseBody" },
        followRedirect: true,
      },
      {
        auth: { username: "24c074604b62474cbeb63b2e939de1b8" },
      },
    );
    const normalized = normalizeProduct(response.data.product ?? null);
    if (normalized) detailsCache.set(url, normalized);
    return normalized;
  })().finally(() => {
    inFlightDetails.delete(url);
  });

  inFlightDetails.set(url, promise);
  return promise;
}
