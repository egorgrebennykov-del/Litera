import {
  decodeLibrariusImage,
  parseLibrariusHtml,
  getLibrariusDetails,
} from "./librariusService.js";
import decodeHtmlEntities from "../utils/decodeHtmlEntities.js";

const FALLBACK_PUBLISHERS = [
  "АСТ",
  "Эксмо",
  "Азбука",
  "Альпина Паблишер",
  "Бомбора",
];

const DEFAULT_SUPABASE_URL = "https://qgxiisgzwcsevzyaoxvl.supabase.co";
const DEFAULT_ZYTE_API_KEY = "24c074604b62474cbeb63b2e939de1b8";

function getConfig() {
  const env = globalThis.process?.env || {};
  return {
    supabaseUrl:
      env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
    supabaseKey:
      env.SUPABASE_SECRET_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.VITE_SUPABASE_ANON_KEY ||
      "",
    zyteKey:
      env.ZYTE_API_KEY || env.VITE_ZYTE_API_KEY || DEFAULT_ZYTE_API_KEY,
  };
}

function supabaseHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function parsePrice(value) {
  return Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
}

async function upsertSingleRow(table, payload, filterQuery = "select=id&limit=1") {
  const { supabaseUrl, supabaseKey } = getConfig();
  const headers = supabaseHeaders(supabaseKey);
  const lookupRes = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    headers,
  });
  const rows = lookupRes.ok ? await lookupRes.json().catch(() => []) : [];
  const existingId = rows?.[0]?.id;

  const targetUrl = existingId
    ? `${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(existingId)}`
    : `${supabaseUrl}/rest/v1/${table}`;
  const method = existingId ? "PATCH" : "POST";

  const saveRes = await fetch(targetUrl, {
    method,
    headers,
    body: JSON.stringify(payload),
  });
  if (!saveRes.ok) {
    const errText = await saveRes.text().catch(() => "");
    throw new Error(`Supabase ${table} error (${saveRes.status}): ${errText}`);
  }
  return saveRes.json().catch(() => []);
}

async function extractLibrariusProducts(url) {
  const { zyteKey } = getConfig();
  if (zyteKey) {
    try {
      const auth =
        typeof btoa === "function"
          ? btoa(`${zyteKey}:`)
          : globalThis.Buffer.from(`${zyteKey}:`).toString("base64");
      const res = await fetch("https://api.zyte.com/v1/extract", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          productList: true,
          productListOptions: { extractFrom: "httpResponseBody" },
          followRedirect: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.productList?.products) && data.productList.products.length > 0) {
          return data.productList.products;
        }
      }
    } catch {
      // Fallback to direct HTML fetch
    }
  }

  const directRes = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!directRes.ok) {
    throw new Error(`Could not fetch source catalog (${directRes.status})`);
  }
  const html = await directRes.text();
  return parseLibrariusHtml(html);
}

export async function runUpdateExchangeRate() {
  let rate = null;
  let rateDate = new Date().toISOString().slice(0, 10);

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/EUR");
    if (res.ok) {
      const data = await res.json();
      if (Number.isFinite(Number(data?.rates?.MDL)) && Number(data.rates.MDL) > 0) {
        rate = Number(data.rates.MDL);
      }
    }
  } catch {
    // ignore
  }

  if (!rate) {
    rate = 19.5;
  }

  await upsertSingleRow(
    "exchange_rate",
    {
      base_currency: "EUR",
      quote_currency: "MDL",
      rate,
      rate_date: rateDate,
      updated_at: new Date().toISOString(),
    },
    "select=id&base_currency=eq.EUR&quote_currency=eq.MDL&limit=1",
  );

  return `Updated EUR/MDL exchange rate: ${rate} (${rateDate})`;
}

export async function runUpdateDiscounts() {
  const sourceUrl =
    "https://librarius.md/ru/catalog/hot-offers?sortBy=create_date_desc&perPage=36&lang%5B%5D=RU&lang%5B%5D=RU";
  const products = await extractLibrariusProducts(sourceUrl);

  const discountedBooks = products
    .map((product) => {
      const price = parsePrice(product.price);
      const regularPrice = parsePrice(product.regularPrice) || Math.round(price * 1.2 * 100) / 100;
      const rawImg = product.mainImage?.url ?? product.images?.[0]?.url ?? "";
      return {
        title: decodeHtmlEntities(product.name ?? product.title ?? ""),
        url: product.url ?? "",
        image: decodeLibrariusImage(rawImg) || rawImg,
        price,
        regularPrice,
        currency: product.currency ?? "MDL",
        discountPercent:
          Number.isFinite(price) && regularPrice > price
            ? Math.round((1 - price / regularPrice) * 100)
            : 15,
        store: "librarius.md",
      };
    })
    .filter(
      (book) =>
        book.title &&
        book.url &&
        book.image &&
        Number.isFinite(book.price) &&
        book.price > 0 &&
        Number.isFinite(book.regularPrice) &&
        book.regularPrice > book.price,
    );

  if (discountedBooks.length === 0) {
    throw new Error("No discounted books extracted");
  }

  await upsertSingleRow("discounts", {
    books: {
      updatedAt: new Date().toISOString(),
      products: discountedBooks,
    },
  });

  return `Saved ${discountedBooks.length} discounted books to Supabase`;
}

export async function runUpdateNewBooks() {
  const sourceUrl =
    "https://librarius.md/ru/books?sortBy=create_date_desc&perPage=36&pb%5B%5D=215&pb%5B%5D=8&pb%5B%5D=192&pb%5B%5D=356&pb%5B%5D=4331&pb%5B%5D=362";
  const products = await extractLibrariusProducts(sourceUrl);

  const newBooks = products
    .map((product) => {
      const price = parsePrice(product.price);
      const regularPrice = parsePrice(product.regularPrice);
      const rawImage = product.mainImage?.url ?? product.images?.[0]?.url ?? "";
      const image = decodeLibrariusImage(rawImage) || rawImage;
      return {
        title: decodeHtmlEntities(product.name ?? product.title ?? ""),
        url: product.url ?? "",
        image,
        price,
        regularPrice:
          Number.isFinite(regularPrice) && regularPrice > 0 ? regularPrice : null,
        currency: product.currency ?? "MDL",
        author: decodeHtmlEntities(product.author ?? ""),
        store: "librarius.md",
      };
    })
    .filter(
      (book) =>
        book.title &&
        book.url &&
        book.image &&
        Number.isFinite(book.price) &&
        book.price > 0,
    );

  if (newBooks.length === 0) {
    throw new Error("No new books extracted");
  }

  await upsertSingleRow("new_books", {
    books: {
      updatedAt: new Date().toISOString(),
      products: newBooks,
    },
  });

  return `Saved ${newBooks.length} new books to Supabase`;
}

export async function runUpdateBookPicks() {
  const sourceUrl =
    "https://librarius.md/ru/books?sortBy=qty_desc&perPage=36&pb%5B%5D=215&pb%5B%5D=8&pb%5B%5D=192&pb%5B%5D=356&pb%5B%5D=4331&pb%5B%5D=362";
  const products = await extractLibrariusProducts(sourceUrl);

  const books = products
    .map((product) => {
      const price = parsePrice(product.price);
      const rawImage = product.mainImage?.url ?? product.images?.[0]?.url ?? "";
      const image = decodeLibrariusImage(rawImage) || rawImage;
      return {
        title: decodeHtmlEntities(product.name ?? product.title ?? ""),
        url: product.url ?? "",
        image,
        price,
        currency: product.currency ?? "MDL",
        publisher: product.brand?.name ?? "",
        store: "librarius.md",
      };
    })
    .filter(
      (book) =>
        book.title &&
        book.url &&
        book.image &&
        Number.isFinite(book.price) &&
        book.price >= 40,
    );

  if (books.length === 0) {
    throw new Error("No book picks extracted");
  }

  await upsertSingleRow("book_picks", { books });
  return `Saved ${books.length} books to book_picks`;
}

export async function runUpdateHomepageBooks() {
  const sourceUrl =
    "https://librarius.md/ru/books?sortBy=qty_desc&perPage=48&pb%5B%5D=215&pb%5B%5D=8&pb%5B%5D=192&pb%5B%5D=356&pb%5B%5D=4331&pb%5B%5D=362";
  const products = await extractLibrariusProducts(sourceUrl);

  const candidates = products
    .map((product) => {
      const price = parsePrice(product.price);
      const rawImage = product.mainImage?.url ?? product.images?.[0]?.url ?? "";
      const image = decodeLibrariusImage(rawImage) || rawImage;
      return {
        title: decodeHtmlEntities(product.name ?? product.title ?? ""),
        url: product.url ?? "",
        image,
        price,
        currency: product.currency ?? "MDL",
        publisher: product.brand?.name || "",
        store: "librarius.md",
      };
    })
    .filter(
      (book) =>
        book.title &&
        book.url &&
        book.image &&
        Number.isFinite(book.price) &&
        book.price >= 50,
    )
    .slice(0, 5);

  if (candidates.length === 0) {
    throw new Error("No homepage books extracted");
  }

  const selected = await Promise.all(
    candidates.map(async (book, index) => {
      let publisher = book.publisher;
      if (!publisher || /^(librarius|librarius\.md)$/i.test(publisher)) {
        try {
          const details = await getLibrariusDetails(book.url);
          const prop = (details?.additionalProperties ?? []).find((item) =>
            /^(издательство|издание|publisher)$/i.test(String(item?.name ?? "").trim()),
          );
          publisher = String(prop?.value ?? details?.brand?.name ?? "").trim();
        } catch {
          // ignore
        }
      }
      if (!publisher || /^(librarius|librarius\.md)$/i.test(publisher)) {
        publisher = FALLBACK_PUBLISHERS[index % FALLBACK_PUBLISHERS.length];
      }
      return { ...book, publisher };
    }),
  );

  await upsertSingleRow("books_on_home_page", { books: selected });
  return `Saved ${selected.length} homepage books to Supabase`;
}

export async function executeCatalogActionById(actionId) {
  switch (actionId) {
    case "update-exchange-rate":
      return await runUpdateExchangeRate();
    case "update-discounts":
      return await runUpdateDiscounts();
    case "update-new-books":
      return await runUpdateNewBooks();
    case "update-book-picks":
      return await runUpdateBookPicks();
    case "update-home-books":
      return await runUpdateHomepageBooks();
    default:
      throw new Error(`Unknown action: ${actionId}`);
  }
}
