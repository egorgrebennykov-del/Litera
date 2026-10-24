import bcrypt from "bcryptjs";

const TABLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user`;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const checkEmail = (email) => {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) throw new Error("Enter a valid email");
  return normalized;
};

export const isLoggedIn = () =>
  document.cookie.split("; ").some((c) => c.startsWith("user="));

export function resolveUserRoles(user) {
  if (!user) return ["user"];

  const isPrivilegedStatus =
    user.status === "privileged" ||
    user.status === "привилегированный" ||
    user.role === "privileged";

  // Если пользователь не имеет статуса привилегированного, его роль всегда только 'user'
  if (!isPrivilegedStatus) {
    return ["user"];
  }

  const rawRole = user.role ?? user.roles;
  let parsedRoles = [];

  if (Array.isArray(rawRole)) {
    parsedRoles = rawRole;
  } else if (typeof rawRole === "string" && rawRole.trim()) {
    try {
      const parsed = JSON.parse(rawRole);
      if (Array.isArray(parsed)) {
        parsedRoles = parsed;
      } else if (typeof parsed === "string") {
        parsedRoles = [parsed];
      }
    } catch {
      parsedRoles = rawRole.split(",").map((r) => r.trim());
    }
  }

  const roleSet = new Set();
  for (const r of parsedRoles) {
    if (!r || typeof r !== "string") continue;
    const norm = r.trim().toLowerCase();
    if (norm === "admin" || norm === "админ" || norm === "administrator") {
      roleSet.add("admin");
    } else if (
      norm === "developer" ||
      norm === "девелопер" ||
      norm === "dev" ||
      norm === "разработчик"
    ) {
      roleSet.add("developer");
    }
  }

  // Если пользователь привилегированный, но не разработчик и не админ, то его роль называется VIP
  if (roleSet.size === 0) {
    return ["vip"];
  }

  return Array.from(roleSet);
}

export function formatRoleName(role, language = "ru") {
  const norm = String(role).trim().toLowerCase();
  if (norm === "developer") return language === "ru" ? "Девелопер" : "Developer";
  if (norm === "admin") return language === "ru" ? "Админ" : "Admin";
  if (norm === "vip") return "VIP";
  return language === "ru" ? "Юзер" : "User";
}

export function formatStatusName(status, language = "ru") {
  const norm = String(status).trim().toLowerCase();
  if (norm === "privileged" || norm === "привилегированный") {
    return language === "ru" ? "Привилегированный" : "Privileged";
  }
  return language === "ru" ? "Юзер" : "User";
}

export const setUserCookie = ({ id, firstName, lastName, email, role, status, roles }) => {
  const userStatus = status || (role === "privileged" ? "privileged" : "user");
  const resolvedRoles = roles || resolveUserRoles({ role, status: userStatus });
  const value = encodeURIComponent(
    JSON.stringify({
      id,
      firstName: firstName || "",
      lastName: lastName || "",
      email: email || "",
      status: userStatus,
      role: resolvedRoles[0] || "user",
      roles: resolvedRoles,
    }),
  );
  document.cookie = `user=${value}; max-age=${7 * 24 * 60 * 60}; path=/; SameSite=Lax`;
};

async function findByEmail(email) {
  const response = await fetch(
    `${TABLE_URL}?select=id,firstName,lastName,email,password_hash,status,role&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers },
  );
  if (!response.ok) throw new Error("Server error, try again later");
  return (await response.json())[0] ?? null;
}

export function parseUserPhones(rawPhone) {
  if (!rawPhone) return [];
  if (Array.isArray(rawPhone)) {
    return rawPhone
      .map((p) =>
        typeof p === "string"
          ? p.trim()
          : (p?.phone || p?.number || "").trim(),
      )
      .filter(Boolean);
  }
  if (typeof rawPhone === "string") {
    try {
      const parsed = JSON.parse(rawPhone);
      if (Array.isArray(parsed)) {
        return parsed
          .map((p) =>
            typeof p === "string"
              ? p.trim()
              : (p?.phone || p?.number || "").trim(),
          )
          .filter(Boolean);
      }
      if (typeof parsed === "string" && parsed.trim()) {
        return [parsed.trim()];
      }
    } catch {
      // not JSON
    }
    if (rawPhone.trim()) return [rawPhone.trim()];
  }
  if (typeof rawPhone === "object") {
    const val = rawPhone.phone || rawPhone.number;
    if (typeof val === "string" && val.trim()) return [val.trim()];
  }
  return [];
}

export async function register({ firstName, lastName, email, password, phone }) {
  const normalized = checkEmail(email);
  if (await findByEmail(normalized)) {
    throw new Error("This email is already registered");
  }

  const phoneArray = phone && phone.trim() ? [phone.trim()] : [];

  const response = await fetch(TABLE_URL, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalized,
      password_hash: await bcrypt.hash(password, 10),
      phone: phoneArray,
      status: "user",
      role: ["user"],
    }),
  });
  if (
    response.status === 409 ||
    (await response.clone().text()).includes("23505")
  ) {
    throw new Error("This email is already registered");
  }
  if (!response.ok) throw new Error("Could not create the account");

  setUserCookie((await response.json())[0]);
}

export async function login(email, password) {
  const user = await findByEmail(checkEmail(email));
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new Error("Invalid email or password");
  }
  setUserCookie(user);
}

export function getCookieUser() {
  const pair = document.cookie.split("; ").find((c) => c.startsWith("user="));
  if (!pair) return null;
  try {
    return JSON.parse(decodeURIComponent(pair.slice(5)));
  } catch {
    return null;
  }
}

export function logout() {
  document.cookie = "user=; max-age=0; path=/; SameSite=Lax";
}

export async function getProfile() {
  const cookieUser = getCookieUser();
  if (!cookieUser) return null;

  const response = await fetch(
    `${TABLE_URL}?select=id,firstName,lastName,email,phone,adresses,status,role&id=eq.${encodeURIComponent(cookieUser.id)}&limit=1`,
    { headers },
  );
  const row = response.ok ? (await response.json())[0] : null;
  if (response.ok && !row) {
    logout();
    return null;
  }
  const phones = parseUserPhones(row?.phone);
  const primaryPhone =
    phones[0] || (typeof row?.phone === "string" ? row.phone.trim() : "");

  const userStatus =
    row?.status || (row?.role === "privileged" ? "privileged" : "user");
  const userRoles = resolveUserRoles({ status: userStatus, role: row?.role });
  const primaryRole = userRoles[0] || "user";

  setUserCookie({
    id: cookieUser.id,
    firstName: row?.firstName || cookieUser.firstName,
    lastName: row?.lastName || cookieUser.lastName || "",
    email: row?.email || cookieUser.email || "",
    status: userStatus,
    role: primaryRole,
    roles: userRoles,
  });

  return {
    id: cookieUser.id,
    firstName: cookieUser.firstName,
    lastName: "",
    email: "",
    status: userStatus,
    role: primaryRole,
    roles: userRoles,
    adresses: [],
    ...(row || {}),
    phone: primaryPhone,
    phones,
  };
}

export function isPrivileged(user) {
  const u = user ?? getCookieUser();
  if (!u) return false;
  if (u.status === "privileged" || u.status === "привилегированный") return true;
  const roles = resolveUserRoles(u);
  return roles.some(
    (r) =>
      r === "admin" ||
      r === "developer" ||
      r === "vip" ||
      r === "privileged",
  );
}

export function hasRole(user, roleName) {
  const roles = resolveUserRoles(user);
  return roles.includes(roleName.toLowerCase().trim());
}

export async function getAllUsers() {
  try {
    const response = await fetch(
      `${TABLE_URL}?select=id,created_at,firstName,lastName,email,phone,status,role&order=created_at.desc`,
      { headers },
    );
    if (!response.ok) return [];
    const list = await response.json();
    if (!Array.isArray(list)) return [];
    return list.map((u) => {
      const userStatus =
        u.status || (u.role === "privileged" ? "privileged" : "user");
      const userRoles = resolveUserRoles({ status: userStatus, role: u.role });
      return {
        ...u,
        status: userStatus,
        roles: userRoles,
        role: u.role,
      };
    });
  } catch (err) {
    console.warn("Error fetching users:", err);
    return [];
  }
}

export async function updateUserStatus(userId, newStatus) {
  const payload = { status: newStatus };
  if (newStatus === "user") {
    payload.role = ["user"];
  }
  const response = await fetch(
    `${TABLE_URL}?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.message || "Could not update user status");
  }
  return (await response.json())[0];
}

export async function updateUserRoles(userId, newRoles) {
  const rolesArray = Array.isArray(newRoles) ? newRoles : [newRoles];
  const payload = { role: rolesArray };
  if (rolesArray.some((r) => r === "developer" || r === "admin" || r === "vip")) {
    payload.status = "privileged";
  }
  const response = await fetch(
    `${TABLE_URL}?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.message || "Could not update user roles");
  }
  return (await response.json())[0];
}

export async function updateUserRole(userId, newRole) {
  if (newRole === "privileged" || newRole === "user") {
    return updateUserStatus(userId, newRole);
  }
  return updateUserRoles(userId, Array.isArray(newRole) ? newRole : [newRole]);
}

export async function getUserPhones(userId) {
  const id = userId ?? getCookieUser()?.id;
  if (!id) return [];
  const response = await fetch(
    `${TABLE_URL}?select=phone&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers },
  );
  if (!response.ok) return [];
  const data = await response.json();
  return parseUserPhones(data?.[0]?.phone);
}

export async function saveUserPhone(userId, newPhone) {
  const id = userId ?? getCookieUser()?.id;
  if (!id) throw new Error("User ID is required");
  if (!newPhone || typeof newPhone !== "string" || !newPhone.trim()) {
    return await getUserPhones(id);
  }
  const cleanPhone = newPhone.trim();
  const current = await getUserPhones(id);
  const normNew = cleanPhone.replace(/[^\d+]/g, "");
  const exists = current.some((p) => p.replace(/[^\d+]/g, "") === normNew);
  if (exists) {
    return current;
  }
  const updated = [...current, cleanPhone];
  const response = await fetch(
    `${TABLE_URL}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ phone: updated }),
    },
  );
  if (!response.ok) {
    throw new Error("Could not save phone to profile");
  }
  return updated;
}

export async function deleteUserPhone(userId, phoneToDelete) {
  const id = userId ?? getCookieUser()?.id;
  if (!id) throw new Error("User ID is required");
  const current = await getUserPhones(id);
  const normDelete = phoneToDelete.replace(/[^\d+]/g, "");
  const updated = current.filter(
    (p) => p.replace(/[^\d+]/g, "") !== normDelete,
  );
  const response = await fetch(
    `${TABLE_URL}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ phone: updated }),
    },
  );
  if (!response.ok) {
    throw new Error("Could not delete phone");
  }
  return updated;
}

export async function getUserAddresses(userId) {
  const id = userId ?? getCookieUser()?.id;
  if (!id) return [];
  const response = await fetch(
    `${TABLE_URL}?select=adresses&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers },
  );
  if (!response.ok) return [];
  const data = await response.json();
  const raw = data?.[0]?.adresses;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return [raw];
  return [];
}

export async function saveUserAddress(userId, newAddress) {
  const id = userId ?? getCookieUser()?.id;
  if (!id) throw new Error("User ID is required");
  const current = await getUserAddresses(id);
  const addressToSave = {
    id:
      newAddress.id ||
      `addr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    recipientName: newAddress.recipientName || "",
    country: newAddress.country || "",
    city: newAddress.city || "",
    street: newAddress.street || "",
    postalCode: newAddress.postalCode || "",
    savedAt: new Date().toISOString(),
  };
  const updated = [...current, addressToSave];
  const response = await fetch(
    `${TABLE_URL}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ adresses: updated }),
    },
  );
  if (!response.ok) {
    throw new Error("Could not save address to profile");
  }
  return addressToSave;
}

export async function deleteUserAddress(userId, addressId) {
  const id = userId ?? getCookieUser()?.id;
  if (!id) throw new Error("User ID is required");
  const current = await getUserAddresses(id);
  const updated = current.filter((addr) => addr.id !== addressId);
  const response = await fetch(
    `${TABLE_URL}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ adresses: updated }),
    },
  );
  if (!response.ok) {
    throw new Error("Could not delete address");
  }
  return updated;
}
