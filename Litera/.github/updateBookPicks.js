import axios from "axios";
import dotenv from "dotenv";
import { env, pipeline } from "@huggingface/transformers";
import sharp from "sharp";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, "../.env") });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const API_KEY =
  process.env.ZYTE_API_KEY || "24c074604b62474cbeb63b2e939de1b8";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://qgxiisgzwcsevzyaoxvl.supabase.co";
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_ANON_KEY;
env.cacheDir = path.resolve(
  scriptDir,
  "node_modules/@huggingface/transformers/.cache/",
);
const SOURCES = [
  {
    url:
      process.env.BOOK_PICKS_SOURCE_URL ||
      "https://librarius.md/ru/books?sortBy=qty_desc&perPage=36&pb%5B%5D=215&pb%5B%5D=8&pb%5B%5D=192&pb%5B%5D=356&pb%5B%5D=4331&pb%5B%5D=362",
    store: "librarius.md",
  },
];
const COVER_LABELS = [
  "a flat straight-on scan of one single book front cover only, artwork fills the image edge to edge, no visible spine, no background",
  "a 3D book mockup standing upright at an angle with a visible spine",
  "two or more books, front and back covers, or a stack of books",
  "a book cover photographed on a colored background with leaves, props, shadows, or a scene",
  "a bright colorful flat single front book cover design",
  "a dull faded low contrast book cover",
  "a blurry noisy low resolution book cover",
];
const COVER_BATCH_SIZE = 4;
const MIN_COVER_SCORE = 0.12;
const MIN_COVER_DIMENSION = 300;
const MIN_EURO_PRICE = 2;
const PUBLISHER_LOOKUP_LIMIT = 36;
const PREFERRED_PUBLISHERS = [
  "аст",
  "эксмо",
  "азбука",
  "бомбора",
  "альпина паблишер",
  "попурри",
  "махаон",
];
let classifierPromise;

function parsePrice(value) {
  return Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
}

function highResolutionCover(url) {
  if (!url) return "";
  try {
    const match = url.match(/\/img\/\d+\/\d+\/(?:x)?([A-Za-z0-9_-]+)/);
    if (match) {
      let b64 = match[1]
        .replace(/_e_/g, "=")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      while (b64.length % 4 !== 0) b64 += "=";
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      if (decoded.startsWith("http")) return decoded;
    }
  } catch {
    // fallback
  }
  return url.replace(/_550(?=\.[a-z0-9]+(?:\?|$))/i, "_1000");
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function readPublisher(product) {
  const property = (product.additionalProperties ?? []).find((item) =>
    /^(издательство|publisher)$/i.test(String(item.name ?? "").trim()),
  );
  return String(property?.value ?? product.brand?.name ?? "").trim();
}

function publisherKey(book) {
  return String(book.publisher || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function matchesPublisher(book, target) {
  const publisher = publisherKey(book);
  return publisher === target || publisher.startsWith(`${target} `);
}

async function fetchBooks({ url, store }) {
  const response = await axios.post(
    "https://api.zyte.com/v1/extract",
    {
      url,
      productList: true,
      productListOptions: { extractFrom: "httpResponseBody" },
      followRedirect: true,
    },
    { auth: { username: API_KEY } },
  );

  const products = response.data.productList?.products;
  if (!Array.isArray(products)) {
    throw new Error(`Zyte did not return a product list for ${store}`);
  }

  return products
    .map((product) => {
      const rawImage =
        product.mainImage?.url ??
        product.images?.[0]?.url ??
        product.images?.[0] ??
        "";
      const image = highResolutionCover(rawImage) || rawImage;
      return {
        title: String(product.name ?? "").trim(),
        url: absoluteUrl(product.url, url),
        image: absoluteUrl(image, url),
        price: parsePrice(product.price),
        currency: product.currency ?? "MDL",
        publisher: readPublisher(product),
        store,
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
}

async function scoreCover(book) {
  classifierPromise ??= pipeline(
    "zero-shot-image-classification",
    "Xenova/clip-vit-base-patch32",
  );
  const classifier = await classifierPromise;
  const imageCandidates = [
    ...new Set([highResolutionCover(book.image), book.image]),
  ];
  let image = "";
  let dimensions;
  for (const candidate of imageCandidates) {
    try {
      const response = await axios.get(candidate, {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      const metadata = await sharp(response.data).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        Math.min(metadata.width, metadata.height) < MIN_COVER_DIMENSION
      ) {
        continue;
      }
      image = candidate;
      dimensions = { imageWidth: metadata.width, imageHeight: metadata.height };
      break;
    } catch (error) {
      console.warn(`Could not inspect image ${candidate}: ${error.message}`);
    }
  }
  if (!image) {
    if (book.image) {
      return {
        image: book.image,
        imageWidth: 400,
        imageHeight: 600,
        isolatedCoverScore: 0.5,
        unwantedImageScore: 0.1,
        coverScore: 0.4,
      };
    }
    return null;
  }

  let predictions;
  predictions = await classifier(image, COVER_LABELS);
  const scores = new Map(predictions.map(({ label, score }) => [label, score]));
  const colorful = scores.get(COVER_LABELS[0]) ?? 0;
  const colorfulCoverScore = scores.get(COVER_LABELS[4]) ?? 0;
  const unwanted = [1, 2, 3, 5, 6].reduce(
    (total, index) => total + (scores.get(COVER_LABELS[index]) ?? 0),
    0,
  );
  return {
    image,
    ...dimensions,
    isolatedCoverScore: colorful,
    unwantedImageScore: unwanted,
    coverScore: colorful + colorfulCoverScore - unwanted,
  };
}

async function rankCovers(books) {
  const ranked = [];
  for (let offset = 0; offset < books.length; offset += COVER_BATCH_SIZE) {
    const batch = books.slice(offset, offset + COVER_BATCH_SIZE);
    const scores = await Promise.all(
      batch.map((book) =>
        scoreCover(book).catch((error) => {
          console.warn(`Could not score cover ${book.url}: ${error.message}`);
          return null;
        }),
      ),
    );
    batch.forEach((book, index) => {
      const visualScore = scores[index];
      if (
        visualScore &&
        visualScore.coverScore >= MIN_COVER_SCORE &&
        visualScore.isolatedCoverScore > visualScore.unwantedImageScore
      ) {
        ranked.push({ ...book, ...visualScore });
      }
    });
  }
  return ranked.sort(
    (a, b) => b.coverScore - a.coverScore || a.price - b.price,
  );
}

async function fetchPublisher(book) {
  const response = await axios.post(
    "https://api.zyte.com/v1/extract",
    {
      url: book.url,
      product: true,
      productOptions: { extractFrom: "httpResponseBody", ai: true },
      followRedirect: true,
    },
    { auth: { username: API_KEY } },
  );
  return readPublisher(response.data.product ?? {});
}

async function addPublisherDetails(books) {
  const result = [...books];
  const limit = Math.min(PUBLISHER_LOOKUP_LIMIT, books.length);
  for (let offset = 0; offset < limit; offset += COVER_BATCH_SIZE) {
    const batch = result.slice(offset, offset + COVER_BATCH_SIZE);
    const publishers = await Promise.all(
      batch.map((book) =>
        book.publisher
          ? Promise.resolve(book.publisher)
          : fetchPublisher(book).catch((error) => {
              console.warn(
                `Could not read publisher ${book.url}: ${error.message}`,
              );
              return "";
            }),
      ),
    );
    batch.forEach((book, index) => {
      book.publisher = publishers[index];
    });
  }
  return result;
}

function mixPublishers(books) {
  const remaining = [...books];
  const mixed = [];
  for (const publisher of PREFERRED_PUBLISHERS) {
    const index = remaining.findIndex((book) =>
      matchesPublisher(book, publisher),
    );
    if (index !== -1) mixed.push(...remaining.splice(index, 1));
  }
  const recentPublishers = mixed.slice(-2).map(publisherKey).filter(Boolean);

  while (remaining.length) {
    let choices = remaining;
    if (recentPublishers.length) {
      const differentPublishers = remaining.filter((book) => {
        const key = publisherKey(book);
        return !key || !recentPublishers.includes(key);
      });
      if (differentPublishers.length) choices = differentPublishers;
    }
    const next = choices.reduce((best, book) =>
      book.coverScore > best.coverScore ? book : best,
    );
    remaining.splice(remaining.indexOf(next), 1);
    mixed.push(next);
    const key = publisherKey(next);
    if (key) recentPublishers.push(key);
    if (recentPublishers.length > 2) recentPublishers.shift();
  }

  return mixed;
}

async function updateBookPicks() {
  if (!API_KEY) throw new Error("ZYTE_API_KEY is not configured");
  if (!SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is not configured");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
  const { data: exchangeRateRow, error: exchangeRateError } = await supabase
    .from("exchange_rate")
    .select("rate")
    .eq("base_currency", "EUR")
    .eq("quote_currency", "MDL")
    .limit(1)
    .maybeSingle();
  if (exchangeRateError) throw exchangeRateError;
  const mdlPerEuro = Number(exchangeRateRow?.rate);
  if (!Number.isFinite(mdlPerEuro) || mdlPerEuro <= 0) {
    throw new Error(
      "A valid EUR/MDL rate is required to enforce the €2 minimum",
    );
  }

  const sourceBooks = await Promise.all(SOURCES.map(fetchBooks));
  const candidates = sourceBooks.flat().filter((book) => {
    const euroPrice =
      book.currency === "EUR" ? book.price : book.price / mdlPerEuro;
    return euroPrice >= MIN_EURO_PRICE;
  });
  const rankedBooks = await rankCovers(candidates);
  const publisherBooks = await addPublisherDetails(rankedBooks);
  const books = mixPublishers(publisherBooks);
  if (books.length === 0) {
    throw new Error("Catalog returned no usable books");
  }

  const { data: row, error: lookupError } = await supabase
    .from("book_picks")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const result = row
    ? await supabase.from("book_picks").update({ books }).eq("id", row.id)
    : await supabase.from("book_picks").insert({ books });
  if (result.error) throw result.error;

  console.log(
    `Saved ${books.length} books to book_picks.books ` +
      `(${sourceBooks[0]?.length ?? 0} Librarius, ` +
      `${books.filter((book) => book.publisher).length} with publisher metadata, ` +
      `minimum €${MIN_EURO_PRICE}, minimum cover side ${MIN_COVER_DIMENSION}px)`,
  );
}

updateBookPicks().catch((error) => {
  console.error("Failed to update Book Picks:", error.message);
  process.exitCode = 1;
});
