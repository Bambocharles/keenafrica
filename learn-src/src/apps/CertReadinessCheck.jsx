import { useState, useCallback, useEffect } from "react";

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 600);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shared exam engine for certification readiness checks.
 *
 * examMeta: {
 *   id, title, provider, examCode, kicker, blurb, accent,
 *   passingScorePct, officialLink,
 *   lengths: [{ label, count }],
 * }
 * domains: [{ key, label, weightPct }]
 * questions: [{ id, domain, question, options: string[], answer: number, explanation }]
 */
export default function CertReadinessCheck({ examMeta, domains, questions: bank }) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 600;

  const [mode, setMode] = useState("menu"); // menu | exam | results
  const [selectedDomain, setSelectedDomain] = useState("all");
  const [selectedLength, setSelectedLength] = useState(
    examMeta.lengths[Math.min(1, examMeta.lengths.length - 1)].count
  );
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState([]);

  const domainByKey = Object.fromEntries(domains.map((d) => [d.key, d]));
  const poolFor = (domainKey) =>
    domainKey === "all" ? bank : bank.filter((q) => q.domain === domainKey);

  const startExam = useCallback(() => {
    const pool = poolFor(selectedDomain);
    const count = Math.min(selectedLength, pool.length);
    const picked = shuffle(pool).slice(0, count);
    const shuffled = picked.map((q) => ({
      ...q,
      shuffledOptions: shuffle(q.options.map((text, i) => ({ text, originalIndex: i }))),
    }));
    setQuestions(shuffled);
    setCurrent(0);
    setSelected(null);
    setAnswered(false);
    setScore(0);
    setHistory([]);
    setMode("exam");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDomain, selectedLength]);

  const handleOption = (shuffledIndex) => {
    if (answered) return;
    const q = questions[current];
    const originalIndex = q.shuffledOptions[shuffledIndex].originalIndex;
    const correct = originalIndex === q.answer;
    setSelected(shuffledIndex);
    setAnswered(true);
    if (correct) setScore((s) => s + 1);
    setHistory((h) => [
      ...h,
      {
        domain: q.domain,
        question: q.question,
        chosenText: q.shuffledOptions[shuffledIndex].text,
        correctText: q.options[q.answer],
        explanation: q.explanation,
        correct,
      },
    ]);
  };

  const next = () => {
    if (current + 1 >= questions.length) {
      setMode("results");
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setAnswered(false);
    }
  };

  const q = questions[current];
  const progress = questions.length ? ((current + (answered ? 1 : 0)) / questions.length) * 100 : 0;
  const scorePct = questions.length ? Math.round((score / questions.length) * 100) : 0;
  const passed = scorePct >= examMeta.passingScorePct;

  const domainStats = domains.map((d) => {
    const rows = history.filter((h) => h.domain === d.key);
    const correct = rows.filter((h) => h.correct).length;
    return { ...d, correct, total: rows.length };
  });
  const missed = history.filter((h) => !h.correct);

  const accent = examMeta.accent || "#2dd4bf";

  const styles = {
    root: {
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a1628 0%, #1a2a4a 50%, #0d1f3c 100%)",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      overflowX: "hidden",
      WebkitTextSizeAdjust: "100%",
    },
    header: {
      width: "100%",
      background: "rgba(255,255,255,0.04)",
      borderBottom: `1px solid ${accent}33`,
      padding: isMobile ? "14px 16px" : "20px 32px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      boxSizing: "border-box",
    },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 40,
      height: 32,
      padding: "0 10px",
      borderRadius: "8px",
      background: accent,
      color: "#0a1628",
      fontWeight: 800,
      fontSize: isMobile ? 11 : 13,
      letterSpacing: "0.02em",
      fontFamily: "'Arial', sans-serif",
      flexShrink: 0,
    },
    titleBox: { flex: 1, minWidth: 0 },
    title: {
      margin: 0,
      fontSize: isMobile ? "16px" : "22px",
      fontWeight: "700",
      color: "#fff",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    subtitle: {
      margin: "2px 0 0",
      fontSize: isMobile ? "10px" : "12px",
      color: "rgba(255,255,255,0.5)",
      letterSpacing: "1px",
      textTransform: "uppercase",
      fontFamily: "'Arial', sans-serif",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    container: {
      width: "100%",
      maxWidth: "760px",
      padding: isMobile ? "16px 12px 60px" : "32px 20px 60px",
      boxSizing: "border-box",
    },
    menuCard: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "16px",
      padding: isMobile ? "20px 16px" : "36px",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    },
    menuTitle: { color: "#fff", fontSize: isMobile ? "20px" : "26px", margin: "0 0 8px", fontWeight: "700" },
    menuDesc: {
      color: "rgba(255,255,255,0.55)",
      fontSize: "14px",
      margin: "0 0 28px",
      lineHeight: "1.6",
      fontFamily: "'Arial', sans-serif",
    },
    label: {
      display: "block",
      color: "rgba(255,255,255,0.7)",
      fontSize: "12px",
      letterSpacing: "1px",
      textTransform: "uppercase",
      marginBottom: "10px",
      fontFamily: "'Arial', sans-serif",
    },
    select: {
      width: "100%",
      padding: isMobile ? "12px 14px" : "14px 16px",
      borderRadius: "10px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: "rgba(0,0,0,0.3)",
      color: "#fff",
      fontSize: isMobile ? "14px" : "15px",
      marginBottom: "22px",
      outline: "none",
      fontFamily: "'Arial', sans-serif",
      cursor: "pointer",
      WebkitAppearance: "none",
      appearance: "none",
      boxSizing: "border-box",
    },
    lengthRow: { display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" },
    lengthBtn: (activeBtn) => ({
      flex: "1 1 100px",
      padding: isMobile ? "10px 8px" : "12px 10px",
      borderRadius: "10px",
      border: `1px solid ${activeBtn ? accent : "rgba(255,255,255,0.15)"}`,
      background: activeBtn ? `${accent}22` : "rgba(255,255,255,0.04)",
      color: activeBtn ? "#fff" : "rgba(255,255,255,0.65)",
      fontFamily: "'Arial', sans-serif",
      fontSize: "13px",
      fontWeight: 700,
      cursor: "pointer",
      textAlign: "center",
    }),
    statsRow: { display: "flex", gap: "10px", marginBottom: "26px", flexWrap: "wrap" },
    statBox: {
      flex: 1,
      minWidth: "80px",
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "10px",
      padding: isMobile ? "12px 8px" : "16px",
      textAlign: "center",
    },
    statNum: { fontSize: isMobile ? "22px" : "28px", fontWeight: "700", color: accent, display: "block" },
    statLabel: {
      fontSize: "10px",
      color: "rgba(255,255,255,0.5)",
      textTransform: "uppercase",
      letterSpacing: "0.6px",
      fontFamily: "'Arial', sans-serif",
    },
    startBtn: {
      width: "100%",
      padding: isMobile ? "14px" : "16px",
      borderRadius: "10px",
      border: "none",
      background: accent,
      color: "#0a1628",
      fontFamily: "'Arial', sans-serif",
      fontWeight: 800,
      fontSize: isMobile ? "14px" : "15px",
      cursor: "pointer",
      letterSpacing: "0.3px",
    },
    officialLink: {
      display: "block",
      textAlign: "center",
      marginTop: "16px",
      fontSize: "12px",
      color: "rgba(255,255,255,0.45)",
      fontFamily: "'Arial', sans-serif",
    },

    // EXAM
    progressTrack: {
      width: "100%",
      height: "6px",
      background: "rgba(255,255,255,0.08)",
      borderRadius: "999px",
      overflow: "hidden",
      marginBottom: "18px",
    },
    progressFill: (pct) => ({
      width: `${pct}%`,
      height: "100%",
      background: accent,
      transition: "width 0.25s ease",
    }),
    metaRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "14px",
      fontFamily: "'Arial', sans-serif",
    },
    counter: { fontSize: "13px", color: "rgba(255,255,255,0.5)" },
    domainTag: {
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "0.4px",
      textTransform: "uppercase",
      color: accent,
      background: `${accent}1a`,
      padding: "4px 10px",
      borderRadius: "999px",
    },
    questionCard: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "14px",
      padding: isMobile ? "18px 16px" : "28px",
    },
    questionText: {
      color: "#fff",
      fontSize: isMobile ? "17px" : "19px",
      lineHeight: 1.5,
      margin: "0 0 20px",
    },
    optionBtn: (state) => {
      const base = {
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: isMobile ? "12px 14px" : "14px 18px",
        marginBottom: "10px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(255,255,255,0.03)",
        color: "#fff",
        fontFamily: "'Arial', sans-serif",
        fontSize: isMobile ? "14px" : "15px",
        cursor: "pointer",
        lineHeight: 1.4,
      };
      if (state === "correct") return { ...base, borderColor: "#34c759", background: "rgba(52,199,89,0.14)" };
      if (state === "wrong") return { ...base, borderColor: "#ff453a", background: "rgba(255,69,58,0.14)" };
      if (state === "reveal") return { ...base, borderColor: "#34c759", opacity: 0.7 };
      return base;
    },
    explanationBox: {
      marginTop: "16px",
      padding: isMobile ? "12px 14px" : "16px 18px",
      borderRadius: "10px",
      background: "rgba(255,255,255,0.05)",
      borderLeft: `3px solid ${accent}`,
      color: "rgba(255,255,255,0.75)",
      fontFamily: "'Arial', sans-serif",
      fontSize: "13.5px",
      lineHeight: 1.6,
    },
    nextBtn: {
      width: "100%",
      marginTop: "18px",
      padding: isMobile ? "13px" : "15px",
      borderRadius: "10px",
      border: "none",
      background: accent,
      color: "#0a1628",
      fontFamily: "'Arial', sans-serif",
      fontWeight: 800,
      fontSize: "14px",
      cursor: "pointer",
    },

    // RESULTS
    resultCard: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "16px",
      padding: isMobile ? "24px 18px" : "36px",
      textAlign: "center",
    },
    resultVerdict: (ok) => ({
      display: "inline-block",
      padding: "6px 18px",
      borderRadius: "999px",
      fontFamily: "'Arial', sans-serif",
      fontWeight: 800,
      fontSize: "13px",
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      marginBottom: "18px",
      color: ok ? "#0a1628" : "#fff",
      background: ok ? "#34c759" : "#ff453a",
    }),
    resultScore: { fontSize: isMobile ? "44px" : "56px", fontWeight: "800", color: "#fff", margin: "0 0 4px" },
    resultSub: { fontSize: "14px", color: "rgba(255,255,255,0.55)", fontFamily: "'Arial', sans-serif", marginBottom: "30px" },
    domainRow: { textAlign: "left", marginBottom: "10px" },
    domainRowHead: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "13px",
      color: "rgba(255,255,255,0.75)",
      fontFamily: "'Arial', sans-serif",
      marginBottom: "5px",
    },
    domainBarTrack: { width: "100%", height: "6px", background: "rgba(255,255,255,0.08)", borderRadius: "999px", overflow: "hidden" },
    actionsRow: { display: "flex", gap: "10px", marginTop: "28px", flexWrap: "wrap" },
    secondaryBtn: {
      flex: 1,
      minWidth: "140px",
      padding: "13px",
      borderRadius: "10px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "transparent",
      color: "#fff",
      fontFamily: "'Arial', sans-serif",
      fontWeight: 700,
      fontSize: "13.5px",
      cursor: "pointer",
    },
    primaryBtn: {
      flex: 1,
      minWidth: "140px",
      padding: "13px",
      borderRadius: "10px",
      border: "none",
      background: accent,
      color: "#0a1628",
      fontFamily: "'Arial', sans-serif",
      fontWeight: 800,
      fontSize: "13.5px",
      cursor: "pointer",
    },
    missedTitle: { color: "#fff", fontSize: "16px", margin: "34px 0 14px", textAlign: "left", fontWeight: 700 },
    missedCard: {
      textAlign: "left",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "10px",
      padding: "14px 16px",
      marginBottom: "10px",
    },
    missedQ: { color: "#fff", fontSize: "14px", marginBottom: "8px", fontFamily: "'Arial', sans-serif" },
    missedRow: { fontSize: "12.5px", fontFamily: "'Arial', sans-serif", marginBottom: "4px" },
  };

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.badge}>{examMeta.examCode || examMeta.provider.slice(0, 3).toUpperCase()}</div>
        <div style={styles.titleBox}>
          <p style={styles.title}>{examMeta.title}</p>
          <p style={styles.subtitle}>{examMeta.provider} readiness check</p>
        </div>
      </div>

      <div style={styles.container}>
        {mode === "menu" && (
          <div style={styles.menuCard}>
            <h2 style={styles.menuTitle}>{examMeta.title}</h2>
            <p style={styles.menuDesc}>{examMeta.blurb}</p>

            <label style={styles.label}>Focus on a domain</label>
            <select
              style={styles.select}
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
            >
              <option value="all">All domains ({bank.length} questions)</option>
              {domains.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} ({poolFor(d.key).length} questions, {d.weightPct}% of exam)
                </option>
              ))}
            </select>

            <label style={styles.label}>Run length</label>
            <div style={styles.lengthRow}>
              {examMeta.lengths.map((l) => (
                <button
                  key={l.count}
                  style={styles.lengthBtn(selectedLength === l.count)}
                  onClick={() => setSelectedLength(l.count)}
                >
                  {l.label}
                  <br />
                  {l.count} Q
                </button>
              ))}
            </div>

            <div style={styles.statsRow}>
              <div style={styles.statBox}>
                <span style={styles.statNum}>{bank.length}</span>
                <span style={styles.statLabel}>Bank size</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statNum}>{domains.length}</span>
                <span style={styles.statLabel}>Domains</span>
              </div>
              <div style={styles.statBox}>
                <span style={styles.statNum}>{examMeta.passingScorePct}%</span>
                <span style={styles.statLabel}>Passing score</span>
              </div>
            </div>

            <button style={styles.startBtn} onClick={startExam}>
              Start practice run →
            </button>
            {examMeta.officialLink && (
              <a
                href={examMeta.officialLink}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.officialLink}
              >
                View the official exam guide ↗
              </a>
            )}
          </div>
        )}

        {mode === "exam" && q && (
          <div>
            <div style={styles.progressTrack}>
              <div style={styles.progressFill(progress)} />
            </div>
            <div style={styles.metaRow}>
              <span style={styles.counter}>
                Question {current + 1} / {questions.length}
              </span>
              <span style={styles.domainTag}>{domainByKey[q.domain]?.label || q.domain}</span>
            </div>
            <div style={styles.questionCard}>
              <p style={styles.questionText}>{q.question}</p>
              {q.shuffledOptions.map((opt, i) => {
                let state = "default";
                if (answered) {
                  if (opt.originalIndex === q.answer) state = "correct";
                  else if (selected === i) state = "wrong";
                }
                return (
                  <button key={i} style={styles.optionBtn(state)} onClick={() => handleOption(i)}>
                    {opt.text}
                  </button>
                );
              })}
              {answered && (
                <div style={styles.explanationBox}>
                  <strong>Why: </strong>
                  {q.explanation}
                </div>
              )}
              {answered && (
                <button style={styles.nextBtn} onClick={next}>
                  {current + 1 >= questions.length ? "See results →" : "Next question →"}
                </button>
              )}
            </div>
          </div>
        )}

        {mode === "results" && (
          <div style={styles.resultCard}>
            <span style={styles.resultVerdict(passed)}>{passed ? "On track to pass" : "Not there yet"}</span>
            <p style={styles.resultScore}>
              {score}/{questions.length}
            </p>
            <p style={styles.resultSub}>
              {scorePct}% correct · passing score is {examMeta.passingScorePct}%
            </p>

            {domainStats.filter((d) => d.total > 0).map((d) => (
              <div key={d.key} style={styles.domainRow}>
                <div style={styles.domainRowHead}>
                  <span>{d.label}</span>
                  <span>
                    {d.correct}/{d.total}
                  </span>
                </div>
                <div style={styles.domainBarTrack}>
                  <div
                    style={{
                      width: `${d.total ? (d.correct / d.total) * 100 : 0}%`,
                      height: "100%",
                      background: d.correct / d.total >= 0.7 ? "#34c759" : "#ff9f0a",
                    }}
                  />
                </div>
              </div>
            ))}

            <div style={styles.actionsRow}>
              <button style={styles.secondaryBtn} onClick={() => setMode("menu")}>
                Back to setup
              </button>
              <button style={styles.primaryBtn} onClick={startExam}>
                Run again
              </button>
            </div>

            {missed.length > 0 && (
              <>
                <p style={styles.missedTitle}>Review missed questions ({missed.length})</p>
                {missed.map((m, i) => (
                  <div key={i} style={styles.missedCard}>
                    <p style={styles.missedQ}>{m.question}</p>
                    <p style={{ ...styles.missedRow, color: "#ff453a" }}>You chose: {m.chosenText}</p>
                    <p style={{ ...styles.missedRow, color: "#34c759" }}>Correct: {m.correctText}</p>
                    <p style={{ ...styles.missedRow, color: "rgba(255,255,255,0.6)" }}>{m.explanation}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
