"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Field, Input, Select } from "@/components/ui";
import { autosaveArticleAction } from "../../actions";
import ui from "@/components/ui/styles.module.css";

/**
 * Session 38 (Keen Africans — Editor Workflow). The autosaving editor
 * body — title/body/excerpt/tags/topic as controlled inputs, saved via
 * autosaveArticleAction (a Server Action invoked directly, NOT bound to a
 * <form>, per Next's own guidance: "invoke it from a form, or from an
 * event handler or useEffect wrapped in startTransition"). Two timers
 * bound how much unsaved typing a crash/reload can lose:
 *   - a 1.5s debounce (fires once typing pauses — the common case), and
 *   - an 8s hard ceiling that fires even during continuous typing, so a
 *     long uninterrupted typing session is never more than ~8s stale.
 * The saved article row IS the resilience mechanism: a reload re-renders
 * this component from the server-loaded article (see page.tsx), which is
 * always at most one autosave tick behind — there is no separate client-
 * side draft store to go stale or conflict with it.
 *
 * The live preview is never a second rendering path: autosaveArticleAction
 * returns HTML from the exact same renderArticleBodyHtml() the public
 * page calls, so what's shown here is what a reader will actually see.
 */

const DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 8000;

export const ARTICLE_TOPIC_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No topic" },
  { value: "cloud", label: "Cloud" },
  { value: "ai", label: "AI" },
  { value: "engineering", label: "Engineering" },
  { value: "entrepreneurship", label: "Entrepreneurship" },
  { value: "career", label: "Career" },
  { value: "business", label: "Business" },
  { value: "culture", label: "Culture" },
];

interface ArticleEditorClientProps {
  articleId: string;
  initialTitle: string;
  initialBody: string;
  initialExcerpt: string;
  initialTags: string;
  initialTopic: string;
  initialPreviewHtml: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function ArticleEditorClient({
  articleId,
  initialTitle,
  initialBody,
  initialExcerpt,
  initialTags,
  initialTopic,
  initialPreviewHtml,
}: ArticleEditorClientProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [excerpt, setExcerpt] = useState(initialExcerpt);
  const [tags, setTags] = useState(initialTags);
  const [topic, setTopic] = useState(initialTopic);
  const [previewHtml, setPreviewHtml] = useState(initialPreviewHtml);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const latest = useRef({ title, body, excerpt, tags, topic });
  latest.current = { title, body, excerpt, tags, topic };
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallback(() => {
    dirtyRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    startTransition(async () => {
      setSaveState("saving");
      const result = await autosaveArticleAction(articleId, latest.current);
      if (result.ok) {
        setSaveState("saved");
        setLastSavedAt(result.savedAt);
        setPreviewHtml(result.previewHtml);
      } else {
        setSaveState("error");
        setSaveError(result.error);
      }
    });
  }, [articleId]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(doSave, DEBOUNCE_MS);
  }, [doSave]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current) doSave();
    }, MAX_WAIT_MS);
    return () => clearInterval(interval);
  }, [doSave]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const statusText =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? `Couldn't save (${saveError ?? "error"}) — still trying`
        : lastSavedAt
          ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
          : "Not saved yet";

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <span
          style={{ fontSize: 12.5, color: saveState === "error" ? "var(--danger, #c0392b)" : "var(--ink-faint)" }}
          role="status"
        >
          {statusText}
        </span>
      </div>

      <div style={{ display: "grid", gap: "14px" }}>
        <Field label="Title">
          <Input
            name="title"
            value={title}
            required
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave();
            }}
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: "14px" }}>
          <Field label="Tags (comma-separated)">
            <Input
              name="tags"
              value={tags}
              placeholder="azure, terraform, security"
              onChange={(e) => {
                setTags(e.target.value);
                scheduleSave();
              }}
            />
          </Field>
          <Field label="Topic">
            <Select
              name="topic"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                scheduleSave();
              }}
            >
              {ARTICLE_TOPIC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Meta description (for search engines and link previews)">
          <Input
            name="excerpt"
            value={excerpt}
            maxLength={300}
            onChange={(e) => {
              setExcerpt(e.target.value);
              scheduleSave();
            }}
          />
        </Field>

        <Field label="Body (Markdown)">
          <textarea
            name="body"
            value={body}
            required
            rows={20}
            className={ui.input}
            style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
            onChange={(e) => {
              setBody(e.target.value);
              scheduleSave();
            }}
          />
        </Field>
      </div>

      <div>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Preview</h3>
        <div className={ui.subCell} dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>
    </div>
  );
}
