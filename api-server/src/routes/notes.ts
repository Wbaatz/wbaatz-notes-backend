import { Router } from "express";
import { randomBytes } from "crypto";
import { db, notesCol, adViewsCol } from "../lib/firebase";
import {
  CreateNoteBody,
  UpdateNoteBody,
  GetNoteParams,
  UpdateNoteParams,
  DeleteNoteParams,
  RecordAdViewBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/notes", async (_req, res) => {
  const snap = await notesCol().orderBy("createdAt", "asc").get();
  res.json(snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title,
      description: data.description,
      subject: data.subject,
      pdfPath: data.pdfPath,
      thumbnailPath: data.thumbnailPath ?? null,
      adViewCount: data.adViewCount,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
    };
  }));
});

router.get("/notes/stats", async (_req, res) => {
  const notesSnap = await notesCol().get();
  const adViewsSnap = await adViewsCol().get();

  const subjectCounts: Record<string, number> = {};
  notesSnap.docs.forEach((d) => {
    const s = (d.data().subject as string) || "General";
    subjectCounts[s] = (subjectCounts[s] || 0) + 1;
  });

  res.json({
    totalNotes: notesSnap.size,
    totalAdViews: adViewsSnap.size,
    subjects: Object.entries(subjectCounts).map(([subject, count]) => ({ subject, count })),
  });
});

router.get("/notes/:id", async (req, res) => {
  const parsed = GetNoteParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid note id" });
    return;
  }

  const accessToken = req.headers["x-access-token"] as string | undefined;
  const noteDoc = await notesCol().doc(String(parsed.data.id)).get();

  if (!noteDoc.exists) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const note = noteDoc.data()!;
  let pdfUrl: string | null = null;

  if (accessToken) {
    const adViewSnap = await adViewsCol()
      .where("accessToken", "==", accessToken)
      .limit(1)
      .get();

    if (!adViewSnap.empty) {
      const adView = adViewSnap.docs[0].data();
      const expires = adView.expiresAt?.toDate ? adView.expiresAt.toDate() : new Date(adView.expiresAt);
      if (String(adView.noteId) === String(parsed.data.id) && expires > new Date()) {
        const pdfKey = (note.pdfKey || note.pdfPath) as string;
        const cleanKey = pdfKey.replace(/^\/objects\//, "").replace(/^\//, "");
        if (cleanKey) {
          const isProd = process.env.NODE_ENV === "production";
          const protocol = isProd ? "https" : (req.protocol || "http");
          const host = req.get("host") || "localhost:3000";
          pdfUrl = `${protocol}://${host}/api/storage/objects/${cleanKey}`;
        }
      }
    }
  }

  res.json({
    id: noteDoc.id,
    title: note.title,
    description: note.description,
    subject: note.subject,
    pdfUrl,
    thumbnailPath: note.thumbnailPath ?? null,
    createdAt: note.createdAt?.toDate ? note.createdAt.toDate().toISOString() : note.createdAt,
  });
});

router.post("/notes", async (req, res) => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = new Date();
  const docRef = await notesCol().add({
    title: parsed.data.title,
    description: parsed.data.description ?? "",
    subject: parsed.data.subject ?? "General",
    pdfPath: parsed.data.pdfPath,
    pdfKey: parsed.data.pdfPath,
    thumbnailPath: parsed.data.thumbnailPath ?? null,
    adViewCount: 0,
    createdAt: now,
  });

  res.status(201).json({
    id: docRef.id,
    title: parsed.data.title,
    description: parsed.data.description ?? "",
    subject: parsed.data.subject ?? "General",
    pdfPath: parsed.data.pdfPath,
    thumbnailPath: parsed.data.thumbnailPath ?? null,
    createdAt: now.toISOString(),
    adViewCount: 0,
  });
});

router.patch("/notes/:id", async (req, res) => {
  const parsed = UpdateNoteParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid note id" });
    return;
  }
  const bodyParsed = UpdateNoteBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const ref = notesCol().doc(String(parsed.data.id));
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (bodyParsed.data.title) updates.title = bodyParsed.data.title;
  if (bodyParsed.data.description) updates.description = bodyParsed.data.description;
  if (bodyParsed.data.subject) updates.subject = bodyParsed.data.subject;
  if (bodyParsed.data.thumbnailPath !== undefined) updates.thumbnailPath = bodyParsed.data.thumbnailPath;

  await ref.update(updates);
  const updated = (await ref.get()).data()!;

  res.json({
    id: ref.id,
    title: updated.title,
    description: updated.description,
    subject: updated.subject,
    pdfPath: updated.pdfPath,
    thumbnailPath: updated.thumbnailPath ?? null,
    createdAt: updated.createdAt?.toDate ? updated.createdAt.toDate().toISOString() : updated.createdAt,
    adViewCount: updated.adViewCount,
  });
});

router.delete("/notes/:id", async (req, res) => {
  const parsed = DeleteNoteParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid note id" });
    return;
  }
  await notesCol().doc(String(parsed.data.id)).delete();
  res.status(204).send();
});

router.post("/ad-views", async (req, res) => {
  const parsed = RecordAdViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { noteId, viewerFingerprint } = parsed.data;
  const noteDoc = await notesCol().doc(String(noteId)).get();
  if (!noteDoc.exists) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const accessToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await adViewsCol().add({
    noteId: String(noteId),
    accessToken,
    viewerFingerprint: viewerFingerprint ?? null,
    expiresAt,
    createdAt: new Date(),
  });

  await noteDoc.ref.update({ adViewCount: (noteDoc.data()!.adViewCount || 0) + 1 });

  res.status(201).json({ accessToken, expiresAt: expiresAt.toISOString(), noteId });
});

export default router;
