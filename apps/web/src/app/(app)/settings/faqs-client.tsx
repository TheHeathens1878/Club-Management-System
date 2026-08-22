"use client";

import { useState } from "react";
import { saveFaq, deleteFaq } from "./faqs-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Pencil, Plus, Check, X, Loader2 } from "lucide-react";

type Faq = { id: string; question: string; answer: string };

export function FaqsClient({ faqs: initial }: { faqs: Faq[] }) {
  const [faqs, setFaqs] = useState<Faq[]>(initial);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(faq: Faq) {
    setEditingId(faq.id);
    setQ(faq.question);
    setA(faq.answer);
    setError(null);
  }

  function startNew() {
    setEditingId("new");
    setQ("");
    setA("");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const isNew = editingId === "new";
    const result = await saveFaq(isNew ? null : editingId, q, a);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    // Optimistic update doesn't have an ID for new items — let the page refresh naturally
    // via revalidatePath, but we can at least update the displayed list
    if (isNew) {
      setFaqs((prev) => [...prev, { id: "_pending_", question: q, answer: a }]);
    } else {
      setFaqs((prev) => prev.map((f) => f.id === editingId ? { ...f, question: q, answer: a } : f));
    }
    setEditingId(null);
  }

  async function handleDelete(id: string, question: string) {
    if (!confirm(`Delete FAQ: "${question}"?`)) return;
    const result = await deleteFaq(id);
    if (result.error) { setError(result.error); return; }
    setFaqs((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div className="space-y-3">
      {faqs.length === 0 && editingId !== "new" && (
        <p className="text-sm text-muted-foreground py-4">No FAQs yet. Add one below — they&apos;ll appear on the public booking page.</p>
      )}

      {faqs.map((faq) => (
        <div key={faq.id} className="rounded-lg border bg-card">
          {editingId === faq.id ? (
            <div className="p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Question</label>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What is included in the hire?" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Answer</label>
                <textarea
                  value={a}
                  onChange={(e) => setA(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Write the full answer here…"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{faq.question}</p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{faq.answer}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => startEdit(faq)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded" title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDelete(faq.id, faq.question)} className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded" title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {editingId === "new" && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase">New FAQ</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase">Question</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What is included in the hire?" autoFocus />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase">Answer</label>
            <textarea
              value={a}
              onChange={(e) => setA(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Write the full answer here…"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          </div>
        </div>
      )}

      {editingId !== "new" && (
        <Button variant="outline" size="sm" onClick={startNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add FAQ
        </Button>
      )}
    </div>
  );
}
