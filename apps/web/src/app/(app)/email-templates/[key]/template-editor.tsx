"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTemplate, resetTemplate, previewTemplate } from "../actions";
import type { TemplateKey, TemplateVariable } from "@/lib/template-engine";
import {
  Bold, Italic, UnderlineIcon, List, ListOrdered, Heading2, Undo, Redo,
  Save, RotateCcw, Eye, EyeOff, Loader2, CheckCircle2, Link2,
} from "lucide-react";

function TB({ onClick, active, title, children }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`rounded p-1.5 transition-colors ${active
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function TemplateEditor({
  templateKey,
  variables,
  initialSubject,
  initialBody,
  isCustomised,
}: {
  templateKey: TemplateKey;
  variables: TemplateVariable[];
  initialSubject: string;
  initialBody: string;
  isCustomised: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const bodyRef = useRef(initialBody);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
    ],
    content: initialBody,
    onUpdate: ({ editor }) => {
      bodyRef.current = editor.getHTML();
    },
    editorProps: {
      attributes: {
        class: "min-h-[280px] px-3 py-2 text-sm focus:outline-none prose prose-sm max-w-none",
      },
    },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== initialBody) {
      editor.commands.setContent(initialBody);
      bodyRef.current = initialBody;
      setSubject(initialSubject);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBody, initialSubject]);

  const insertVariable = useCallback((key: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`{{${key}}}`).run();
  }, [editor]);

  const handleSetLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href ?? "";
    const url = window.prompt("Enter URL", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveTemplate(templateKey, subject, bodyRef.current);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset this template to the system default? Any customisations will be lost.")) return;
    setResetting(true);
    setError(null);
    try {
      await resetTemplate(templateKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset");
      setResetting(false);
    }
  }

  async function handlePreview() {
    if (previewHtml) {
      setPreviewHtml(null);
      return;
    }
    setLoadingPreview(true);
    try {
      const html = await previewTemplate(templateKey, subject, bodyRef.current);
      setPreviewHtml(html);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Editor */}
        <div className="lg:col-span-2 space-y-4">
          {/* Subject */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Subject line</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject…"
              className="font-medium"
            />
            <p className="text-xs text-muted-foreground">You can use variables like <code className="bg-muted px-1 rounded">{"{{name}}"}</code> in the subject too.</p>
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Body</label>
            <div className="rounded-md border bg-background">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
                {editor && (
                  <>
                    <TB onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">
                      <Bold className="h-3.5 w-3.5" />
                    </TB>
                    <TB onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">
                      <Italic className="h-3.5 w-3.5" />
                    </TB>
                    <TB onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline">
                      <UnderlineIcon className="h-3.5 w-3.5" />
                    </TB>
                    <div className="mx-1 h-4 w-px bg-border" />
                    <TB onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading">
                      <Heading2 className="h-3.5 w-3.5" />
                    </TB>
                    <TB onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">
                      <List className="h-3.5 w-3.5" />
                    </TB>
                    <TB onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">
                      <ListOrdered className="h-3.5 w-3.5" />
                    </TB>
                    <TB onClick={handleSetLink} active={editor.isActive("link")} title="Insert link">
                      <Link2 className="h-3.5 w-3.5" />
                    </TB>
                    <div className="mx-1 h-4 w-px bg-border" />
                    <TB onClick={() => editor.chain().focus().undo().run()} title="Undo">
                      <Undo className="h-3.5 w-3.5" />
                    </TB>
                    <TB onClick={() => editor.chain().focus().redo().run()} title="Redo">
                      <Redo className="h-3.5 w-3.5" />
                    </TB>
                  </>
                )}
              </div>
              <EditorContent editor={editor} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave} disabled={saving || resetting} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save template
            </Button>
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={loadingPreview || saving}
              className="gap-2"
            >
              {loadingPreview
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : previewHtml ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {previewHtml ? "Hide preview" : "Preview email"}
            </Button>
            {isCustomised && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={resetting || saving}
                className="gap-2 text-muted-foreground"
              >
                {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Reset to default
              </Button>
            )}
            {saved && (
              <span className="flex items-center gap-1 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Saved
              </span>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        {/* Sidebar: variables */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Available variables
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Click a variable to insert it at the cursor position.
            </p>
            <div className="flex flex-col gap-2">
              {variables.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVariable(v.key)}
                  className="group flex flex-col items-start rounded-md border bg-background px-3 py-2 text-left hover:bg-primary/5 hover:border-primary/30 transition-colors"
                >
                  <code className="text-xs font-mono text-primary group-hover:text-primary">
                    {`{{${v.key}}}`}
                  </code>
                  <span className="text-xs text-muted-foreground mt-0.5">{v.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Tips
            </p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>The club header and footer are added automatically.</li>
              <li>Variables in the subject line also get substituted.</li>
              <li>Use Preview to see the full rendered email.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Email preview */}
      {previewHtml && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Preview — rendered with example values
          </p>
          <div className="rounded-lg border overflow-hidden bg-muted/20">
            <iframe
              srcDoc={previewHtml}
              title="Email preview"
              className="w-full"
              style={{ height: 600, border: "none" }}
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}
    </div>
  );
}
