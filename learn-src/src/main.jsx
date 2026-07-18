import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import DutchVocabGame from "./apps/DutchVocabGame.jsx";
import KNMExam from "./apps/KNMExam.jsx";
import SchrijvenDrill from "./apps/SchrijvenDrill.jsx";
import logoIcon from "./assets/logo-icon.png";

// ---------- Keen Africa design tokens ----------
const T = {
  cream: "#FAF6EC",
  paper: "#FFFCF4",
  ink: "#1F1A14",
  inkSoft: "#4A3F33",
  inkMuted: "#7A6D5E",
  green: "#1F3D2A",
  greenDeep: "#15291C",
  terracotta: "#B85C38",
  gold: "#D9A852",
  line: "rgba(31,26,20,0.12)",
  display: '"Fraunces", "Times New Roman", serif',
  body: '"Manrope", system-ui, sans-serif',
};

const APPS = [
  {
    id: "vocab",
    title: "Dutch Vocab Game",
    kicker: "Vocabulary · Nederlands",
    blurb:
      "Build Dutch vocabulary through fast, game-style rounds. Ideal groundwork for the inburgering exams and everyday fluency.",
    component: DutchVocabGame,
  },
  {
    id: "knm",
    title: "KNM Practice Exam",
    kicker: "Civic knowledge · Inburgering",
    blurb:
      "Full practice runs for the KNM exam (Kennis van de Nederlandse Maatschappij) — timed questions in real exam format.",
    component: KNMExam,
  },
  {
    id: "schrijven",
    title: "Schrijven Drill",
    kicker: "Writing · Inburgering",
    blurb:
      "Structured drills for the Dutch writing exam: prompts, model answers, and repetition until it sticks.",
    component: SchrijvenDrill,
  },
];

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#\/?/, ""));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace(/^#\/?/, ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
}

function TopBar({ inApp }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(250,246,236,0.9)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${T.line}`,
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: T.body,
        }}
      >
        <a
          href="../index.html"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
            color: T.greenDeep,
            fontFamily: T.display,
            fontWeight: 500,
            fontSize: 20,
          }}
        >
          <img
            src={logoIcon}
            alt=""
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              display: "block",
              objectFit: "contain",
            }}
          />
          Keen Africa
        </a>
        {inApp ? (
          <a
            href="#/"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: T.inkSoft,
              textDecoration: "none",
            }}
          >
            ← All learning tools
          </a>
        ) : (
          <a
            href="../index.html"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: T.inkSoft,
              textDecoration: "none",
            }}
          >
            ← Home
          </a>
        )}
      </div>
    </header>
  );
}

function Hub() {
  return (
    <div style={{ background: T.cream, minHeight: "100vh" }}>
      <TopBar inApp={false} />
      <main
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "64px 24px 96px",
          fontFamily: T.body,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: T.terracotta,
            marginBottom: 16,
          }}
        >
          The Learning Lab
        </div>
        <h1
          style={{
            fontFamily: T.display,
            fontWeight: 400,
            fontSize: "clamp(36px, 5vw, 56px)",
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            color: T.greenDeep,
            margin: "0 0 18px",
          }}
        >
          Practice tools, free.{" "}
          <em style={{ fontStyle: "italic", fontWeight: 300, color: T.terracotta }}>
            Runs on your device.
          </em>
        </h1>
        <p
          style={{
            fontSize: 17,
            color: T.inkSoft,
            maxWidth: 640,
            lineHeight: 1.65,
            marginBottom: 12,
          }}
        >
          Serious preparation tools built by Keen Africa. Everything runs entirely in
          your browser — once a page loads, no internet is needed to keep practicing.
        </p>
        <p style={{ fontSize: 14.5, color: T.inkMuted, maxWidth: 640, marginBottom: 48 }}>
          First up: Dutch exam preparation — for the thousands of ambitious Africans
          studying, working, and settling in the Netherlands. The UTME/JAMB practice
          app is in development and lands here next.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 22,
          }}
        >
          {APPS.map((app) => (
            <a
              key={app.id}
              href={`#/${app.id}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                background: T.paper,
                border: `1px solid ${T.line}`,
                borderRadius: 10,
                padding: "30px 30px 26px",
                textDecoration: "none",
                transition: "transform .2s, border-color .2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = T.terracotta;
                e.currentTarget.style.transform = "translateY(-3px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.line;
                e.currentTarget.style.transform = "none";
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.13em",
                  textTransform: "uppercase",
                  color: T.gold,
                }}
              >
                {app.kicker}
              </div>
              <div
                style={{
                  fontFamily: T.display,
                  fontWeight: 500,
                  fontSize: 25,
                  color: T.greenDeep,
                  lineHeight: 1.15,
                }}
              >
                {app.title}
              </div>
              <p style={{ margin: 0, fontSize: 14.5, color: T.inkSoft, lineHeight: 1.6, flex: 1 }}>
                {app.blurb}
              </p>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.terracotta, marginTop: 8 }}>
                Start practicing →
              </span>
            </a>
          ))}
        </div>
      </main>
      <footer
        style={{
          borderTop: `1px solid ${T.line}`,
          padding: "26px 24px",
          textAlign: "center",
          fontSize: 13,
          color: T.inkMuted,
          fontFamily: T.body,
        }}
      >
        © {new Date().getFullYear()} Keen Africa · Built in Akure, with conviction
      </footer>
    </div>
  );
}

function FeedbackWidget({ appId, appTitle }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | sending | done | error
  const [topic, setTopic] = useState("app");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic,
          appId,
          appTitle,
          rating: rating || undefined,
          message,
          email: email || undefined,
          kf_hp: hp || undefined,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.ok) throw new Error(result.error || "Failed to send");
      setStatus("done");
      setMessage("");
      setRating(0);
      setEmail("");
    } catch {
      setStatus("error");
    }
  }

  const fieldLabel = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: T.inkMuted,
    marginBottom: 4,
  };
  const fieldInput = {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 11px",
    borderRadius: 6,
    border: `1px solid ${T.line}`,
    fontFamily: T.body,
    fontSize: 14,
    color: T.ink,
    background: T.cream,
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close feedback form" : "Leave feedback"}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 60,
          background: T.terracotta,
          color: T.cream,
          border: "none",
          borderRadius: 999,
          padding: "13px 22px",
          fontFamily: T.body,
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,0.22)",
        }}
      >
        {open ? "Close" : "Feedback"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            right: 20,
            bottom: 78,
            zIndex: 60,
            width: 320,
            maxWidth: "calc(100vw - 40px)",
            maxHeight: "calc(100vh - 120px)",
            overflowY: "auto",
            background: T.paper,
            border: `1px solid ${T.line}`,
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 16px 44px rgba(0,0,0,0.28)",
            fontFamily: T.body,
          }}
        >
          {status === "done" ? (
            <div>
              <p style={{ margin: 0, fontFamily: T.display, fontSize: 19, color: T.greenDeep }}>
                Thank you.
              </p>
              <p style={{ marginTop: 8, fontSize: 14, color: T.inkSoft, lineHeight: 1.5 }}>
                Your feedback has been sent — we read everything.
              </p>
              <button
                onClick={() => {
                  setOpen(false);
                  setStatus("idle");
                }}
                style={{
                  marginTop: 14,
                  background: "none",
                  border: `1px solid ${T.line}`,
                  borderRadius: 6,
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: T.inkSoft,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <p style={{ margin: "0 0 14px", fontFamily: T.display, fontSize: 19, color: T.greenDeep }}>
                Got a moment?
              </p>

              <div style={{ marginBottom: 12 }}>
                <label style={fieldLabel} htmlFor="fb-topic">What's this about?</label>
                <select
                  id="fb-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  style={fieldInput}
                >
                  <option value="app">This app{appTitle ? ` — ${appTitle}` : ""}</option>
                  <option value="blog">The blog</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={fieldLabel}>Rating (optional)</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n === rating ? 0 : n)}
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 22,
                        lineHeight: 1,
                        padding: 0,
                        color: n <= rating ? T.gold : T.line,
                      }}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={fieldLabel} htmlFor="fb-message">Your feedback</label>
                <textarea
                  id="fb-message"
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What worked, what didn't, what would you change?"
                  style={{ ...fieldInput, minHeight: 78, resize: "vertical" }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={fieldLabel} htmlFor="fb-email">Email (optional, if you'd like a reply)</label>
                <input
                  id="fb-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={fieldInput}
                />
              </div>

              <div style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} aria-hidden="true">
                <label htmlFor="kf-hp">Leave this field blank</label>
                <input
                  id="kf-hp"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={status === "sending"}
                style={{
                  width: "100%",
                  background: T.terracotta,
                  color: T.cream,
                  border: "none",
                  borderRadius: 6,
                  padding: "11px 0",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: status === "sending" ? "not-allowed" : "pointer",
                  opacity: status === "sending" ? 0.6 : 1,
                }}
              >
                {status === "sending" ? "Sending…" : "Send feedback"}
              </button>

              {status === "error" && (
                <p style={{ marginTop: 10, fontSize: 12.5, color: T.terracotta, lineHeight: 1.5 }}>
                  Something went wrong — email us directly at learn@keenafrica.com.
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </>
  );
}

function App() {
  const route = useHashRoute();
  const active = APPS.find((a) => a.id === route);
  if (!active) return <Hub />;
  const Active = active.component;
  return (
    <div style={{ minHeight: "100vh", background: T.cream }}>
      <TopBar inApp />
      <Active />
      <FeedbackWidget appId={active.id} appTitle={active.title} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
