function normalizeTitle(t) {
  return (t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeImageUrl(img) {
  if (!img || typeof img !== "string") return "";
  let target = img;
  if (target.startsWith("/api/enhance-image?url=")) {
    try {
      target =
        new URL(target, "http://localhost").searchParams.get("url") || target;
    } catch {
      // ignore
    }
  }
  return target.split("?")[0].trim().toLowerCase();
}

export function dedupeBooksFast(books) {
  if (!Array.isArray(books) || books.length < 2) return books;

  // 1. Fast pre-pass: match books across stores by identical normalized title or identical image URL
  const titleGroups = new Map();
  const imageGroups = new Map();

  for (let i = 0; i < books.length; i++) {
    const norm = normalizeTitle(books[i].title);
    if (norm) {
      if (!titleGroups.has(norm)) titleGroups.set(norm, []);
      titleGroups.get(norm).push(i);
    }
    const img = normalizeImageUrl(books[i].image);
    if (img) {
      if (!imageGroups.has(img)) imageGroups.set(img, []);
      imageGroups.get(img).push(i);
    }
  }

  const removedIndices = new Set();
  const processGroup = (indices) => {
    if (indices.length < 2) return;
    const stores = new Set(indices.map((idx) => books[idx].store));
    if (stores.size < 2) return; // Only deduplicate across different bookstores

    let minPrice = Infinity;
    for (const idx of indices) {
      const price = Number.isFinite(books[idx].price)
        ? books[idx].price
        : Infinity;
      if (price < minPrice) minPrice = price;
    }
    if (!Number.isFinite(minPrice)) return;

    const cheapestStores = new Set();
    for (const idx of indices) {
      if (books[idx].price === minPrice) {
        cheapestStores.add(books[idx].store);
      }
    }

    // If a book is on another site and is more expensive than the cheapest site's book,
    // remove the book from the other site and KEEP all books from the first site
    for (const idx of indices) {
      const book = books[idx];
      if (!cheapestStores.has(book.store) && book.price > minPrice) {
        removedIndices.add(idx);
      }
    }
  };

  for (const indices of titleGroups.values()) processGroup(indices);
  for (const indices of imageGroups.values()) processGroup(indices);

  return books.filter((_, idx) => !removedIndices.has(idx));
}

export default async function dedupeBooks(books) {
  return dedupeBooksFast(books);
}
