# Learning Lab source

Vite/React source for the apps served at `/learn/`: Dutch Vocab Game, KNM Practice
Exam, Schrijven Drill, and five certification readiness checks (Cloud Fundamentals,
AZ-900, AWS Cloud Practitioner, Google Cloud Digital Leader, Cisco CCST Networking).
The certification checks share one engine, `src/apps/CertReadinessCheck.jsx`, fed by
per-exam data files in `src/certData/`; each `src/apps/*Exam.jsx` file is a thin
wrapper that just supplies `examMeta` + a question bank to that engine.

To add or edit an app:

```bash
npm install
npm run build
cp -r dist/* ../public/learn/
```

Then commit the updated `public/learn/` output along with your source changes.
