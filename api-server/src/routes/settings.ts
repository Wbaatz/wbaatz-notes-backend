import { Router } from "express";
import { settingsCol } from "../lib/firebase";

const router = Router();
const SETTINGS_DOC = "global";

async function getOrCreateSettings() {
  const ref = settingsCol().doc(SETTINGS_DOC);
  const snap = await ref.get();
  if (snap.exists) return snap.data()!;
  await ref.set({ requireAdEveryVisit: false });
  return { requireAdEveryVisit: false };
}

router.get("/settings", async (_req, res) => {
  const settings = await getOrCreateSettings();
  res.json({ requireAdEveryVisit: settings.requireAdEveryVisit });
});

router.put("/settings", async (req, res) => {
  const { requireAdEveryVisit } = req.body;
  if (typeof requireAdEveryVisit !== "boolean") {
    res.status(400).json({ error: "requireAdEveryVisit must be a boolean" });
    return;
  }
  const ref = settingsCol().doc(SETTINGS_DOC);
  await ref.set({ requireAdEveryVisit }, { merge: true });
  res.json({ requireAdEveryVisit });
});

export default router;
