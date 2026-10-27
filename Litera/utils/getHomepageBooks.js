const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  "https://qgxiisgzwcsevzyaoxvl.supabase.co";
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE_URL = `${SUPABASE_URL}/rest/v1/books_on_home_page`;

const STORAGE_KEY = "kazbook_homepage_books_v1";
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedBooks = null;
let cacheExpiry = 0;
let inflight = null;

function readStoredBooks() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function getCachedHomepageBooks() {
  if (cachedBooks !== null) return cachedBooks;
  const stored = readStoredBooks();
  if (stored) {
    cachedBooks = stored;
  }
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
    if (typeof window !== "undefined" && result.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      } catch {
        // ignore storage quota errors
      }
    }
    return result;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
