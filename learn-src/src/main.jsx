import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import DutchVocabGame from "./apps/DutchVocabGame.jsx";
import KNMExam from "./apps/KNMExam.jsx";
import SchrijvenDrill from "./apps/SchrijvenDrill.jsx";

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
          <span
            style={{
              width: 30,
              height: 30,
              background: T.green,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              color: T.gold,
              fontStyle: "italic",
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            K
          </span>
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

function App() {
  const route = useHashRoute();
  const active = APPS.find((a) => a.id === route);
  if (!active) return <Hub />;
  const Active = active.component;
  return (
    <div style={{ minHeight: "100vh", background: T.cream }}>
      <TopBar inApp />
      <Active />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
