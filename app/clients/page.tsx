"use client";
// app/clients/page.tsx — Client list + Add/Edit/Delete
// Each client row links to the client detail page (/clients/[id])

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  listClients, saveClient, updateClient, deleteClient,
  type Client,
} from "@/app/_lib/clients";
import { listProjectsByClientNum } from "@/app/_lib/projects";

// ─── Types ────────────────────────────────────────────────────────────────────

const EMPTY_FORM = { clientNumber: "", name: "", address: "", phone: "", email: "" };
type ClientForm = typeof EMPTY_FORM;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const router = useRouter();

  const [clients,    setClients]    = useState<Client[]>([]);
  const [projCounts, setProjCounts] = useState<Record<string, number>>({});
  const [search,     setSearch]     = useState("");
  const [showAdd,    setShowAdd]    = useState(false);
  const [addForm,    setAddForm]    = useState<ClientForm>(EMPTY_FORM);
  const [addError,   setAddError]   = useState("");
  const [editId,     setEditId]     = useState<string | null>(null);
  const [editForm,   setEditForm]   = useState<ClientForm>(EMPTY_FORM);
  const [editError,  setEditError]  = useState("");
  const [deleteId,   setDeleteId]   = useState<string | null>(null);

  const addNameRef  = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const all = listClients();
    setClients(all);
    // Compute project counts per client (for badge display)
    const counts: Record<string, number> = {};
    for (const c of all) {
      counts[c.id] = listProjectsByClientNum(c.clientNumber).length;
    }
    setProjCounts(counts);
  }, []);

  useEffect(() => {
    if (showAdd) setTimeout(() => addNameRef.current?.focus(), 50);
  }, [showAdd]);

  useEffect(() => {
    if (editId) setTimeout(() => editNameRef.current?.focus(), 50);
  }, [editId]);

  // ── Add ──────────────────────────────────────────────────────────────────────

  function handleOpenAdd() {
    setAddForm(EMPTY_FORM);
    setAddError("");
    setShowAdd(true);
    setEditId(null);
  }

  function handleAddSubmit() {
    if (!addForm.name.trim())         { setAddError("Client name is required."); return; }
    if (!addForm.clientNumber.trim()) { setAddError("Client # is required."); return; }
    try {
      saveClient({
        clientNumber: addForm.clientNumber.trim(),
        name:         addForm.name.trim(),
        address:      addForm.address.trim(),
        phone:        addForm.phone.trim(),
        email:        addForm.email.trim(),
      });
      const updated = listClients();
      setClients(updated);
      const counts: Record<string, number> = {};
      for (const c of updated) counts[c.id] = listProjectsByClientNum(c.clientNumber).length;
      setProjCounts(counts);
      setShowAdd(false);
      setAddForm(EMPTY_FORM);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to save client.");
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────────

  function handleStartEdit(c: Client) {
    setShowAdd(false);
    setEditId(c.id);
    setEditForm({ clientNumber: c.clientNumber, name: c.name, address: c.address, phone: c.phone, email: c.email });
    setEditError("");
  }

  function handleEditSubmit() {
    if (!editId) return;
    if (!editForm.name.trim())         { setEditError("Client name is required."); return; }
    if (!editForm.clientNumber.trim()) { setEditError("Client # is required."); return; }
    try {
      updateClient(editId, {
        clientNumber: editForm.clientNumber.trim(),
        name:         editForm.name.trim(),
        address:      editForm.address.trim(),
        phone:        editForm.phone.trim(),
        email:        editForm.email.trim(),
      });
      const updated = listClients();
      setClients(updated);
      const counts: Record<string, number> = {};
      for (const c of updated) counts[c.id] = listProjectsByClientNum(c.clientNumber).length;
      setProjCounts(counts);
      setEditId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to update client.");
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  function handleConfirmDelete() {
    if (!deleteId) return;
    deleteClient(deleteId);
    setClients(prev => prev.filter(c => c.id !== deleteId));
    setProjCounts(prev => { const n = { ...prev }; delete n[deleteId]; return n; });
    setDeleteId(null);
    if (editId === deleteId) setEditId(null);
  }

  // ── Filter ───────────────────────────────────────────────────────────────────

  const q = search.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c =>
        c.clientNumber.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
      )
    : clients;

  const clientToDelete = deleteId ? clients.find(c => c.id === deleteId) : null;

  // ── Styles ───────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: "13px",
    border: "1.5px solid #d0cac2", borderRadius: "6px",
    color: "#111", backgroundColor: "#fff", boxSizing: "border-box", outline: "none",
  };
  const lbl: React.CSSProperties = { fontSize: "11px", fontWeight: "700", color: "#555", marginBottom: "4px", display: "block" };
  const g2: React.CSSProperties  = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh", backgroundColor: "#f5f2ee",
      display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{
        backgroundColor: "#1a1a1a", color: "#fff", padding: "0 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, height: "56px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={() => router.push("/")}
            style={{ background: "none", border: "none", color: "#aaa", fontSize: "20px",
              cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>
            ←
          </button>
          <span style={{ fontSize: "15px", fontWeight: "800" }}>Clients</span>
          {clients.length > 0 && (
            <span style={{ fontSize: "11px", color: "#888", backgroundColor: "#333",
              borderRadius: "12px", padding: "2px 8px" }}>
              {clients.length}
            </span>
          )}
        </div>
        <button onClick={handleOpenAdd}
          style={{ fontSize: "12px", fontWeight: "700", cursor: "pointer",
            padding: "6px 16px", borderRadius: "8px",
            backgroundColor: "#fff", color: "#1a1a1a", border: "none" }}>
          + Add Client
        </button>
      </header>

      {/* Add Client form panel */}
      {showAdd && (
        <div style={{ backgroundColor: "#fff", borderBottom: "2px solid #1a1a1a", padding: "20px" }}>
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: "16px" }}>
              <span style={{ fontSize: "14px", fontWeight: "800" }}>New Client</span>
              <button onClick={() => setShowAdd(false)}
                style={{ background: "none", border: "none", fontSize: "16px",
                  color: "#aaa", cursor: "pointer" }}>✕</button>
            </div>
            <ClientFormFields
              form={addForm} onChange={setAddForm}
              nameRef={addNameRef} inp={inp} lbl={lbl} g2={g2}
            />
            {addError && (
              <p style={{ color: "#c0392b", fontSize: "12px", margin: "8px 0 0" }}>{addError}</p>
            )}
            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button onClick={handleAddSubmit}
                style={{ padding: "8px 20px", borderRadius: "7px", border: "none",
                  backgroundColor: "#1a1a1a", color: "#fff", fontSize: "13px",
                  fontWeight: "700", cursor: "pointer" }}>
                Save Client
              </button>
              <button onClick={() => setShowAdd(false)}
                style={{ padding: "8px 16px", borderRadius: "7px",
                  border: "1.5px solid #d0ccc5", backgroundColor: "#fff",
                  fontSize: "13px", cursor: "pointer", color: "#555" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      {clients.length > 0 && (
        <div style={{ backgroundColor: "#fff", borderBottom: "1px solid #e5e0d8", padding: "10px 20px" }}>
          <input
            type="text"
            placeholder="Search by name, client #, email, or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inp, maxWidth: "400px", backgroundColor: "#fafaf8" }}
          />
        </div>
      )}

      {/* Body */}
      <main style={{ flex: 1, padding: "24px 20px", maxWidth: "800px", width: "100%",
        margin: "0 auto", boxSizing: "border-box" }}>

        {/* Empty state */}
        {clients.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "#888" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>👤</div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#444", marginBottom: "8px" }}>
              No clients yet
            </div>
            <div style={{ fontSize: "14px", marginBottom: "24px" }}>
              Add a client to auto-fill their info when starting new projects.
            </div>
            <button onClick={handleOpenAdd}
              style={{ padding: "10px 24px", borderRadius: "8px", border: "none",
                backgroundColor: "#1a1a1a", color: "#fff", fontSize: "14px",
                fontWeight: "600", cursor: "pointer" }}>
              + Add First Client
            </button>
          </div>
        )}

        {/* No results */}
        {clients.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
            <div style={{ fontSize: "16px" }}>No clients match &ldquo;{search}&rdquo;</div>
          </div>
        )}

        {/* Client list */}
        {filtered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {filtered.map(c => (
              <ClientRow
                key={c.id}
                client={c}
                projectCount={projCounts[c.id] ?? 0}
                isEditing={editId === c.id}
                editForm={editForm}
                editError={editError}
                editNameRef={editId === c.id ? editNameRef : undefined}
                onOpen={() => router.push(`/clients/${c.id}`)}
                onEdit={() => handleStartEdit(c)}
                onEditChange={setEditForm}
                onEditSubmit={handleEditSubmit}
                onEditCancel={() => setEditId(null)}
                onDelete={() => setDeleteId(c.id)}
                inp={inp} lbl={lbl} g2={g2}
              />
            ))}
          </div>
        )}
      </main>

      {/* Delete confirm modal */}
      {deleteId && clientToDelete && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
        }}>
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "28px 32px",
            width: "100%", maxWidth: "380px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "17px", fontWeight: "800" }}>Delete client?</h3>
            <p style={{ margin: "0 0 24px", fontSize: "14px", color: "#555", lineHeight: 1.5 }}>
              <strong>{clientToDelete.name}</strong> (#{clientToDelete.clientNumber}) will be permanently deleted.
              Their projects will remain and can still be found in the Projects view.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteId(null)}
                style={{ padding: "8px 18px", borderRadius: "7px", border: "1.5px solid #d0ccc5",
                  backgroundColor: "#fff", fontSize: "13px", fontWeight: "600",
                  cursor: "pointer", color: "#333" }}>
                Cancel
              </button>
              <button onClick={handleConfirmDelete}
                style={{ padding: "8px 18px", borderRadius: "7px", border: "none",
                  backgroundColor: "#c0392b", color: "#fff", fontSize: "13px",
                  fontWeight: "600", cursor: "pointer" }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ClientFormFields ─────────────────────────────────────────────────────────

interface FormFieldsProps {
  form:      ClientForm;
  onChange:  (f: ClientForm) => void;
  nameRef?:  React.RefObject<HTMLInputElement | null>;
  inp:       React.CSSProperties;
  lbl:       React.CSSProperties;
  g2:        React.CSSProperties;
}

function ClientFormFields({ form, onChange, nameRef, inp, lbl, g2 }: FormFieldsProps) {
  function set(field: keyof ClientForm, value: string) {
    onChange({ ...form, [field]: value });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={g2}>
        <div>
          <label style={lbl}>Client Name *</label>
          <input ref={nameRef as React.RefObject<HTMLInputElement>}
            style={inp} type="text" placeholder="e.g. John Smith"
            value={form.name} onChange={e => set("name", e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Client # *</label>
          <input style={inp} type="text" placeholder="e.g. 1042"
            value={form.clientNumber} onChange={e => set("clientNumber", e.target.value)} />
        </div>
      </div>
      <div>
        <label style={lbl}>Address</label>
        <input style={inp} type="text" placeholder="e.g. 123 Main St, City, State"
          value={form.address} onChange={e => set("address", e.target.value)} />
      </div>
      <div style={g2}>
        <div>
          <label style={lbl}>Phone</label>
          <input style={inp} type="tel" placeholder="e.g. (555) 123-4567"
            value={form.phone} onChange={e => set("phone", e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Email</label>
          <input style={inp} type="email" placeholder="e.g. john@example.com"
            value={form.email} onChange={e => set("email", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

// ─── ClientRow ────────────────────────────────────────────────────────────────

interface ClientRowProps {
  client:       Client;
  projectCount: number;
  isEditing:    boolean;
  editForm:     ClientForm;
  editError:    string;
  editNameRef?: React.RefObject<HTMLInputElement | null>;
  onOpen:       () => void;
  onEdit:       () => void;
  onEditChange: (f: ClientForm) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onDelete:     () => void;
  inp:          React.CSSProperties;
  lbl:          React.CSSProperties;
  g2:           React.CSSProperties;
}

function ClientRow({
  client: c, projectCount, isEditing, editForm, editError, editNameRef,
  onOpen, onEdit, onEditChange, onEditSubmit, onEditCancel, onDelete,
  inp, lbl, g2,
}: ClientRowProps) {
  if (isEditing) {
    return (
      <div style={{ backgroundColor: "#fff", borderRadius: "10px",
        border: "2px solid #1a1a1a", padding: "18px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "14px" }}>
          <span style={{ fontSize: "13px", fontWeight: "800" }}>Editing #{c.clientNumber}</span>
          <button onClick={onEditCancel}
            style={{ background: "none", border: "none", fontSize: "16px", color: "#aaa", cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <ClientFormFields
          form={editForm} onChange={onEditChange}
          nameRef={editNameRef} inp={inp} lbl={lbl} g2={g2}
        />
        {editError && (
          <p style={{ color: "#c0392b", fontSize: "12px", margin: "8px 0 0" }}>{editError}</p>
        )}
        <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
          <button onClick={onEditSubmit}
            style={{ padding: "7px 18px", borderRadius: "6px", border: "none",
              backgroundColor: "#1a1a1a", color: "#fff", fontSize: "12px",
              fontWeight: "700", cursor: "pointer" }}>
            Save Changes
          </button>
          <button onClick={onEditCancel}
            style={{ padding: "7px 14px", borderRadius: "6px",
              border: "1.5px solid #d0ccc5", backgroundColor: "#fff",
              fontSize: "12px", cursor: "pointer", color: "#555" }}>
            Cancel
          </button>
          <button onClick={onDelete}
            style={{ marginLeft: "auto", padding: "7px 14px", borderRadius: "6px",
              border: "1.5px solid #ffd5d5", backgroundColor: "#fff8f8",
              fontSize: "12px", cursor: "pointer", color: "#c0392b" }}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#fff", borderRadius: "10px",
      border: "1.5px solid #e5e0d8", padding: "16px 20px",
      display: "flex", alignItems: "center", gap: "16px" }}>
      {/* Avatar */}
      <div style={{ width: "44px", height: "44px", borderRadius: "50%",
        backgroundColor: "#1a1a1a", color: "#fff", display: "flex",
        alignItems: "center", justifyContent: "center", fontSize: "15px",
        fontWeight: "800", flexShrink: 0 }}>
        {c.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", fontWeight: "800", color: "#1a1a1a" }}>{c.name}</span>
          <span style={{ fontSize: "11px", fontWeight: "700", color: "#888",
            backgroundColor: "#f0eee9", borderRadius: "4px", padding: "1px 6px" }}>
            #{c.clientNumber}
          </span>
          {projectCount > 0 && (
            <span style={{ fontSize: "11px", color: "#15803d",
              backgroundColor: "#dcfce7", borderRadius: "4px", padding: "1px 7px",
              fontWeight: "700" }}>
              {projectCount} project{projectCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div style={{ fontSize: "12px", color: "#888", marginTop: "3px",
          display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
          {c.phone   && <span>{c.phone}</span>}
          {c.email   && <span>{c.email}</span>}
          {c.address && <span>{c.address}</span>}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
        {/* Primary: open client detail */}
        <button onClick={onOpen}
          style={{ padding: "7px 16px", borderRadius: "6px", border: "none",
            backgroundColor: "#1a1a1a", color: "#fff",
            fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
          Open →
        </button>
        <button onClick={onEdit}
          style={{ padding: "7px 14px", borderRadius: "6px",
            border: "1.5px solid #d0ccc5", backgroundColor: "#fff",
            fontSize: "12px", fontWeight: "600", cursor: "pointer", color: "#333" }}>
          Edit
        </button>
        <button onClick={onDelete}
          style={{ padding: "7px 10px", borderRadius: "6px",
            border: "1.5px solid #ffd5d5", backgroundColor: "#fff8f8",
            fontSize: "13px", cursor: "pointer", color: "#c0392b" }}>
          🗑
        </button>
      </div>
    </div>
  );
}
