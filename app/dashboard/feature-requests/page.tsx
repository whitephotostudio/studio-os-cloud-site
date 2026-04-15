"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronUp, Plus, MessageSquare, Check, Clock, X, Loader2 } from "lucide-react";

type FeatureRequest = {
  id: string;
  photographer_id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "done" | "declined";
  vote_count: number;
  admin_note: string;
  created_at: string;
  updated_at: string;
  has_voted: boolean;
};

const STATUS_CONFIG = {
  open: { label: "Open", color: "#3b82f6", bg: "#eff6ff", icon: MessageSquare },
  in_progress: { label: "In Progress", color: "#f59e0b", bg: "#fffbeb", icon: Clock },
  done: { label: "Done", color: "#22c55e", bg: "#f0fdf4", icon: Check },
  declined: { label: "Declined", color: "#94a3b8", bg: "#f8fafc", icon: X },
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 20,
  border: "1px solid #e5e7eb",
  padding: "20px 24px",
  marginBottom: 12,
};

export default function FeatureRequestsPage() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const supabase = createClient();

  const fetchRequests = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const url = filter === "all"
      ? "/api/feature-requests"
      : `/api/feature-requests?status=${filter}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    if (json.ok) setRequests(json.data);
    setLoading(false);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: pg } = await supabase
        .from("photographers")
        .select("is_platform_admin")
        .eq("user_id", user.id)
        .maybeSingle();
      if (pg?.is_platform_admin || user.email?.toLowerCase() === "harout@me.com") {
        setIsAdmin(true);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch("/api/feature-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ title: title.trim(), description: description.trim() }),
    });

    setTitle("");
    setDescription("");
    setShowForm(false);
    setSubmitting(false);
    fetchRequests();
  }

  async function handleVote(requestId: string) {
    setVotingId(requestId);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch("/api/feature-requests/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ feature_request_id: requestId }),
    });

    const json = await res.json();
    if (json.ok) {
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                has_voted: json.voted,
                vote_count: json.voted ? r.vote_count + 1 : r.vote_count - 1,
              }
            : r,
        ),
      );
    }
    setVotingId(null);
  }

  async function handleStatusChange(requestId: string, status: string, adminNote?: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch("/api/feature-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: "update_status", request_id: requestId, status, admin_note: adminNote }),
    });

    fetchRequests();
  }

  const filterButtons = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
  ];

  return (
    <div style={{ padding: "32px 40px", maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Feature Requests
          </h1>
          <p style={{ fontSize: 14, color: "#0f172a", marginTop: 4 }}>
            Vote on features you want or suggest new ones.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "#0f172a",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={16} /> New Request
        </button>
      </div>

      {/* Submit form */}
      {showForm && (
        <form onSubmit={handleSubmit} style={{ ...cardStyle, marginBottom: 24, border: "2px solid #0f172a" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#000000", marginBottom: 6 }}>
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What feature would help your workflow?"
              maxLength={200}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                fontSize: 15,
                color: "#000000",
                outline: "none",
              }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#000000", marginBottom: 6 }}>
              Details (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you need and why it would help..."
              rows={3}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                fontSize: 14,
                color: "#000000",
                outline: "none",
                resize: "vertical",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              style={{
                background: "#0f172a",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting || !title.trim() ? 0.5 : 1,
              }}
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                background: "transparent",
                color: "#64748b",
                border: "1px solid #d1d5db",
                borderRadius: 10,
                padding: "10px 20px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {filterButtons.map((fb) => (
          <button
            key={fb.key}
            onClick={() => setFilter(fb.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: filter === fb.key ? "1px solid #0f172a" : "1px solid #e5e7eb",
              background: filter === fb.key ? "#0f172a" : "#fff",
              color: filter === fb.key ? "#fff" : "#64748b",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {fb.label}
          </button>
        ))}
      </div>

      {/* Request list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      ) : requests.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 }}>
          No feature requests yet. Be the first to suggest one!
        </div>
      ) : (
        requests.map((req) => {
          const statusConfig = STATUS_CONFIG[req.status];
          const StatusIcon = statusConfig.icon;

          return (
            <div key={req.id} style={cardStyle}>
              <div style={{ display: "flex", gap: 16 }}>
                {/* Vote button */}
                <button
                  onClick={() => handleVote(req.id)}
                  disabled={votingId === req.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: req.has_voted ? "2px solid #0f172a" : "1px solid #e5e7eb",
                    background: req.has_voted ? "#f1f5f9" : "#fff",
                    cursor: votingId === req.id ? "wait" : "pointer",
                    minWidth: 52,
                    flexShrink: 0,
                  }}
                >
                  <ChevronUp size={16} color={req.has_voted ? "#0f172a" : "#94a3b8"} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: req.has_voted ? "#0f172a" : "#64748b" }}>
                    {req.vote_count}
                  </span>
                </button>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 600, color: "#0f172a" }}>
                      {req.title}
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 10px",
                        borderRadius: 20,
                        background: statusConfig.bg,
                        color: statusConfig.color,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      <StatusIcon size={12} /> {statusConfig.label}
                    </span>
                  </div>

                  {req.description && (
                    <p style={{ fontSize: 14, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
                      {req.description}
                    </p>
                  )}

                  {req.admin_note && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "8px 12px",
                        borderRadius: 8,
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        fontSize: 13,
                        color: "#000000",
                      }}
                    >
                      <strong>Team note:</strong> {req.admin_note}
                    </div>
                  )}

                  <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
                    {new Date(req.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>

                  {/* Admin controls */}
                  {isAdmin && (
                    <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {req.status !== "in_progress" && (
                        <button
                          onClick={() => handleStatusChange(req.id, "in_progress")}
                          style={adminBtnStyle("#f59e0b")}
                        >
                          Mark In Progress
                        </button>
                      )}
                      {req.status !== "done" && (
                        <button
                          onClick={() => handleStatusChange(req.id, "done")}
                          style={adminBtnStyle("#22c55e")}
                        >
                          Mark Done
                        </button>
                      )}
                      {req.status !== "declined" && (
                        <button
                          onClick={() => handleStatusChange(req.id, "declined")}
                          style={adminBtnStyle("#94a3b8")}
                        >
                          Decline
                        </button>
                      )}
                      {req.status !== "open" && (
                        <button
                          onClick={() => handleStatusChange(req.id, "open")}
                          style={adminBtnStyle("#3b82f6")}
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const note = prompt("Add a note for this request:", req.admin_note);
                          if (note !== null) handleStatusChange(req.id, req.status, note);
                        }}
                        style={adminBtnStyle("#64748b")}
                      >
                        Add Note
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function adminBtnStyle(color: string): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${color}40`,
    background: `${color}10`,
    color,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  };
}
