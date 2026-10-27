import { getCookieUser, logout } from "./auth.js";
import getExchangeRate, { DEFAULT_RATE } from "./getExchangeRate.js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://qgxiisgzwcsevzyaoxvl.supabase.co";
const TABLE_URL = `${SUPABASE_URL}/rest/v1/cart`;
const KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_b9UI3PiZhUvPTcroS9oMOg_NyHBwtxw";
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

const DEFAULT_MDL_EUR_RATE = DEFAULT_RATE;

async function getRate() {
  try {
    const rate = await getExchangeRate();
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch {
    // fallback below
  }
  return DEFAULT_MDL_EUR_RATE;
}

function requireUserId(userId) {
  const id = userId ?? getCookieUser()?.id;
  if (!id) throw new Error("Sign in to use your cart");
  return id;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMsg = `${body?.message || ""} ${body?.details || ""} ${body?.hint || ""}`;
    if (errorMsg.includes("cart_user_id_fkey") || response.status === 409) {
      logout();
      throw new Error("Your session has expired. Please sign in again.");
    }
    throw new Error(body?.message ?? body?.hint ?? "Could not access the cart");
  }
  return body;
}

export async function getCart(userId = getCookieUser()?.id) {
  const id = requireUserId(userId);
  const params = new URLSearchParams({
    select: "id,link,price,user_id,image,title,shop,quantity",
    user_id: `eq.${id}`,
    order: "id.desc",
  });
  const rows = (await request(`${TABLE_URL}?${params}`)) ?? [];

  const needsHeal = rows.some((item) => Number(item.price) > 45);
  if (needsHeal) {
    const rate = await getRate();
    for (const item of rows) {
      const p = Number(item.price);
      if (Number.isFinite(p) && p > 45) {
        const healedPrice = Math.round((p / rate) * 100) / 100;
        item.price = healedPrice;
        const patchParams = new URLSearchParams({
          id: `eq.${item.id}`,
          user_id: `eq.${id}`,
        });
        request(`${TABLE_URL}?${patchParams}`, {
          method: "PATCH",
          body: JSON.stringify({ price: healedPrice }),
        }).catch((err) =>
          console.warn("Failed to persist auto-healed cart price:", err),
        );
      }
    }
  }

  return rows;
}

export async function getCartItem(url, userId = getCookieUser()?.id) {
  const id = requireUserId(userId);
  const params = new URLSearchParams({
    select: "id",
    user_id: `eq.${id}`,
    link: `eq.${url}`,
    limit: "1",
  });
  const rows = await request(`${TABLE_URL}?${params}`);
  return rows?.[0] ?? null;
}

export async function hasCartItem(url, userId = getCookieUser()?.id) {
  return Boolean(await getCartItem(url, userId));
}

export async function addToCart(book, userId = getCookieUser()?.id) {
  const id = requireUserId(userId);
  let rawPrice = Number(book.price);
  if (!Number.isFinite(rawPrice)) rawPrice = 0;

  let finalPrice = rawPrice;
  // If explicitly MDL, or if currency is not EUR and price > 45, or if price is abnormally high (> 45)
  if (
    book.currency === "MDL" ||
    (book.currency !== "EUR" && finalPrice > 45) ||
    finalPrice > 45
  ) {
    const rate = await getRate();
    finalPrice = Math.round((finalPrice / rate) * 100) / 100;
  } else {
    finalPrice = Math.round(finalPrice * 100) / 100;
  }

  const params = new URLSearchParams({
    select: "id,link,price,user_id,image,title,shop,quantity",
    user_id: `eq.${id}`,
    link: `eq.${book.url}`,
    limit: "1",
  });
  const existing = await request(`${TABLE_URL}?${params}`);
  if (existing?.length) return existing[0];

  const inserted = await request(TABLE_URL, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      link: book.url,
      price: finalPrice,
      user_id: id,
      image: book.image,
      title: book.title,
      shop: book.store || book.shop,
      quantity: Math.max(1, Math.floor(Number(book.quantity) || 1)),
    }),
  });
  return inserted?.[0] ?? null;
}

export async function updateCartQuantity(
  cartItemId,
  quantity,
  userId = getCookieUser()?.id,
) {
  const id = requireUserId(userId);
  const nextQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const params = new URLSearchParams({
    id: `eq.${cartItemId}`,
    user_id: `eq.${id}`,
  });
  await request(`${TABLE_URL}?${params}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity: nextQuantity }),
  });
  return nextQuantity;
}

export async function removeFromCart(cartItemId, userId = getCookieUser()?.id) {
  const id = requireUserId(userId);
  const params = new URLSearchParams({
    id: `eq.${cartItemId}`,
    user_id: `eq.${id}`,
  });
  await request(`${TABLE_URL}?${params}`, { method: "DELETE" });
}

export async function clearCart(userId = getCookieUser()?.id) {
  const id = requireUserId(userId);
  const params = new URLSearchParams({
    user_id: `eq.${id}`,
  });
  await request(`${TABLE_URL}?${params}`, { method: "DELETE" });
}
