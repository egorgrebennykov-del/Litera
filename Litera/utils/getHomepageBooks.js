const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  "https://qgxiisgzwcsevzyaoxvl.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE_URL = `${SUPABASE_URL}/rest/v1/books_on_home_page`;

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedBooks = null;
let cacheExpiry = 0;
let inflight = null;

export function getCachedHomepageBooks() {
  return cachedBooks;
}

export default async function getHomepageBooks() {
  if (cachedBooks !== null && Date.now() < cacheExpiry) {
    return cachedBooks;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const response = await fetch(`${TABLE_URL}?select=books&limit=1`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message ?? "Could not load featured books");
    }

    const rows = await response.json();
    const books = rows[0]?.books;
    const result = Array.isArray(books) ? books : [];
    cachedBooks = result;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return result;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
