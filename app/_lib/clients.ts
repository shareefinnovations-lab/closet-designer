// app/_lib/clients.ts
//
// Client persistence store — localStorage-backed.
// Client # (clientNumber) is the canonical lookup key.
//
// Storage key: closet-clients  →  JSON: Client[]

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Client {
  id:           string;   // internal unique id
  clientNumber: string;   // the human-assigned "Client #" — lookup key
  name:         string;
  address:      string;
  phone:        string;
  email:        string;
  createdAt:    string;   // ISO 8601
  updatedAt:    string;   // ISO 8601
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLIENTS_KEY = "closet-clients";

// ─── ID generation ────────────────────────────────────────────────────────────

export function createClientId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Low-level store ──────────────────────────────────────────────────────────

function readClients(): Client[] {
  try {
    const raw = localStorage.getItem(CLIENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Client[];
  } catch {
    return [];
  }
}

function writeClients(clients: Client[]): void {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** List all clients, alphabetically by name. */
export function listClients(): Client[] {
  return readClients().sort((a, b) => a.name.localeCompare(b.name));
}

/** Find a client by internal id. */
export function getClient(id: string): Client | null {
  return readClients().find(c => c.id === id) ?? null;
}

/** Find a client by client number (case-insensitive, trimmed). Returns first match. */
export function getClientByNumber(clientNumber: string): Client | null {
  const q = clientNumber.trim().toLowerCase();
  if (!q) return null;
  return readClients().find(c => c.clientNumber.trim().toLowerCase() === q) ?? null;
}

/** Save a new client. Throws if clientNumber is already taken. Returns the saved client. */
export function saveClient(data: Omit<Client, "id" | "createdAt" | "updatedAt">): Client {
  const existing = getClientByNumber(data.clientNumber);
  if (existing) throw new Error(`Client # "${data.clientNumber}" already exists.`);
  const now = new Date().toISOString();
  const client: Client = {
    ...data,
    id:        createClientId(),
    createdAt: now,
    updatedAt: now,
  };
  writeClients([...readClients(), client]);
  return client;
}

/** Update an existing client by id. Returns updated client or null if not found. */
export function updateClient(id: string, data: Partial<Omit<Client, "id" | "createdAt">>): Client | null {
  const clients = readClients();
  const idx = clients.findIndex(c => c.id === id);
  if (idx < 0) return null;

  // If clientNumber is changing, check for collision
  if (data.clientNumber !== undefined) {
    const q = data.clientNumber.trim().toLowerCase();
    const collision = clients.find((c, i) => i !== idx && c.clientNumber.trim().toLowerCase() === q);
    if (collision) throw new Error(`Client # "${data.clientNumber}" already exists.`);
  }

  const updated: Client = {
    ...clients[idx],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  clients[idx] = updated;
  writeClients(clients);
  return updated;
}

/** Delete a client by id. */
export function deleteClient(id: string): void {
  writeClients(readClients().filter(c => c.id !== id));
}

/** Format a client for a one-line display string. */
export function clientDisplayLine(c: Client): string {
  const parts = [c.name];
  if (c.clientNumber) parts.push(`#${c.clientNumber}`);
  if (c.phone) parts.push(c.phone);
  return parts.join(" · ");
}
