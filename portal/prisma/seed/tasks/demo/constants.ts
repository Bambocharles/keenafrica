/**
 * Shared, stable identifiers for the canonical demo/test universe
 * (testing/demo-data.md). Both the seed (./index.ts) and the wipe half of
 * the reset process (../../reset-demo.ts) import from here — the wipe
 * targets exactly these names/domain, never a heuristic, so seeding and
 * resetting can never silently drift apart.
 *
 * DEMO_EMAIL_DOMAIN is the single safety-relevant constant in this file:
 * every demo account's email ends with it, which is what lets the reset
 * process (and, per CLAUDE_BUILD_RULES.md §10, anything checking for known
 * demo credentials) identify demo users without a schema change.
 */
export const DEMO_EMAIL_DOMAIN = "demo.keenafrica.dev";
export const DEMO_PASSWORD = "DemoPass123!";

export function demoEmail(localPart: string): string {
  return `${localPart}@${DEMO_EMAIL_DOMAIN}`;
}

export const DEMO_COURSE_TITLES = [
  "Digital Literacy Fundamentals",
  "Financial Literacy for Entrepreneurs",
  "Agribusiness Essentials",
] as const;

export const DEMO_SPONSOR_NAMES = [
  "Baobab Impact Foundation",
  "Sahel Youth Trust",
  "Nile Skills Alliance",
] as const;

export const DEMO_ORGANIZATION_NAMES = [
  "Baobab Learning Hub",
  "Sahel Community School",
] as const;

/** Organization-Aware Education (Session 21) — the one ORGANIZATION-scoped course in the canonical demo dataset, under Baobab Learning Hub. */
export const DEMO_ORG_COURSE_TITLE = "Baobab Hub: Community Bookkeeping";

export const DEMO_TOPIC_NAMES = [
  "Computer Basics",
  "Internet Safety",
  "Budgeting",
  "Savings & Credit",
  "Crop Management",
  "Market Access",
] as const;

export const STUDENT_FIRST_NAMES = [
  "Amara",
  "Chidi",
  "Ngozi",
  "Kwame",
  "Abena",
  "Kofi",
  "Fatima",
  "Ibrahim",
  "Wanjiru",
  "Njeri",
  "Tendai",
  "Chipo",
  "Zainab",
  "Aliyu",
  "Adaeze",
  "Emeka",
  "Amina",
  "Sadio",
  "Nkechi",
  "Baraka",
] as const;

export const STUDENT_LAST_NAMES = [
  "Okafor",
  "Mensah",
  "Adeyemi",
  "Kamau",
  "Diallo",
  "Moyo",
  "Bello",
  "Suleiman",
  "Chikwanha",
  "Eze",
  "Mwangi",
  "Osei",
  "Abara",
  "Nkosi",
  "Traore",
  "Abubakar",
  "Nwosu",
  "Kariuki",
  "Banda",
  "Diop",
] as const;

/** Deterministic name for student index i (0-based) — same input always produces the same name, so the seed is reproducible. */
export function studentName(i: number): string {
  const first = STUDENT_FIRST_NAMES[i % STUDENT_FIRST_NAMES.length];
  const last = STUDENT_LAST_NAMES[Math.floor(i / STUDENT_FIRST_NAMES.length) % STUDENT_LAST_NAMES.length];
  return `${first} ${last}`;
}
