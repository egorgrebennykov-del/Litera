const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const TABLE_URL = `${SUPABASE_URL}/rest/v1/announcements`;
const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

/**
 * Normalizes an announcement row from Supabase.
 */
export function normalizeAnnouncement(row) {
  if (!row) return null;

  let parsedContent = {};
  if (typeof row.content === "object" && row.content !== null) {
    parsedContent = row.content;
  } else if (typeof row.content === "string") {
    try {
      parsedContent = JSON.parse(row.content);
    } catch {
      parsedContent = { text: row.content };
    }
  }

  return {
    id: row.id,
    created_at: row.created_at,
    from: row.from || row.created_at,
    until: row.until,
    userId: row.user_id,
    type: parsedContent.type === "large" ? "large" : "small",
    text: parsedContent.text || "",
    imageUrl: parsedContent.imageUrl || "",
    linkUrl: parsedContent.linkUrl || "",
    order: Number(parsedContent.order ?? 0),
    active: parsedContent.active !== false,
  };
}

/**
 * Fetch all announcements for the Privileged panel.
 */
export async function fetchAllAnnouncementsAdmin() {
  try {
    const res = await fetch(`${TABLE_URL}?select=*&order=created_at.desc`, { headers });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];

    const normalized = list.map(normalizeAnnouncement).filter(Boolean);
    // Sort by order ascending, then created_at desc
    return normalized.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  } catch (err) {
    console.warn("Error fetching admin announcements:", err);
    return [];
  }
}

/**
 * Fetch currently active announcements for the frontend (Home page).
 * Filters strictly by dates: from <= now && until >= now.
 */
export async function fetchActiveAnnouncements() {
  try {
    const res = await fetch(`${TABLE_URL}?select=*&order=created_at.desc`, { headers });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];

    const now = new Date();

    const normalized = list
      .map(normalizeAnnouncement)
      .filter((item) => {
        if (!item || !item.active) return false;
        // From date check
        if (item.from) {
          const fromDate = new Date(item.from);
          if (fromDate > now) return false;
        }
        // Until date check (strictly required by requirements)
        if (item.until) {
          const untilDate = new Date(item.until);
          if (untilDate < now) return false;
        } else {
          return false; // Until is mandatory
        }
        return true;
      });

    // Sort by order ascending
    return normalized.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  } catch (err) {
    console.warn("Error fetching active announcements:", err);
    return [];
  }
}

/**
 * Create a new announcement.
 * 'until' is mandatory!
 */
export async function createAnnouncement({
  type = "small", // "small" | "large"
  text = "",
  imageUrl = "",
  linkUrl = "",
  order = 0,
  from = null,
  until,
  userId = null,
}) {
  if (!until) {
    throw new Error("Срок окончания показа объявления обязателен для заполнения");
  }

  if (type === "large" && !imageUrl?.trim()) {
    throw new Error("Для большого объявления ссылка на фото обязательна");
  }

  if (type === "small" && !text?.trim()) {
    throw new Error("Для небольшого объявления текст обязателен");
  }

  const fromDate = from ? new Date(from).toISOString() : new Date().toISOString();
  const untilDate = new Date(until).toISOString();

  const content = {
    type: type === "large" ? "large" : "small",
    text: text ? text.trim() : "",
    imageUrl: imageUrl ? imageUrl.trim() : "",
    linkUrl: linkUrl ? linkUrl.trim() : "",
    order: Number(order) || 0,
    active: true,
  };

  const payload = {
    user_id: userId || null,
    from: fromDate,
    until: untilDate,
    content,
  };

  const res = await fetch(TABLE_URL, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || "Не удалось создать объявление");
  }

  const created = await res.json();
  return normalizeAnnouncement(created?.[0]);
}

/**
 * Update an existing announcement.
 */
export async function updateAnnouncement(id, {
  type = "small",
  text = "",
  imageUrl = "",
  linkUrl = "",
  order = 0,
  from,
  until,
  active = true,
}) {
  if (!id) throw new Error("ID объявления обязателен");
  if (!until) {
    throw new Error("Срок окончания показа объявления обязателен для заполнения");
  }

  if (type === "large" && !imageUrl?.trim()) {
    throw new Error("Для большого объявления ссылка на фото обязательна");
  }

  if (type === "small" && !text?.trim()) {
    throw new Error("Для небольшого объявления текст обязателен");
  }

  const fromDate = from ? new Date(from).toISOString() : new Date().toISOString();
  const untilDate = new Date(until).toISOString();

  const content = {
    type: type === "large" ? "large" : "small",
    text: text ? text.trim() : "",
    imageUrl: imageUrl ? imageUrl.trim() : "",
    linkUrl: linkUrl ? linkUrl.trim() : "",
    order: Number(order) || 0,
    active: active !== false,
  };

  const payload = {
    from: fromDate,
    until: untilDate,
    content,
  };

  const res = await fetch(`${TABLE_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || "Не удалось обновить объявление");
  }

  const updated = await res.json();
  return normalizeAnnouncement(updated?.[0]);
}

/**
 * Delete an announcement.
 */
export async function deleteAnnouncement(id) {
  if (!id) return;
  const res = await fetch(`${TABLE_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || "Не удалось удалить объявление");
  }
}

/**
 * Reorder a list of announcements by index.
 */
export async function reorderAnnouncements(orderedList) {
  if (!Array.isArray(orderedList)) return;

  const promises = orderedList.map(async (item, idx) => {
    const newOrder = idx + 1;
    const content = {
      type: item.type,
      text: item.text,
      imageUrl: item.imageUrl,
      linkUrl: item.linkUrl,
      order: newOrder,
      active: item.active !== false,
    };

    return fetch(`${TABLE_URL}?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ content }),
    });
  });

  await Promise.all(promises);
}
