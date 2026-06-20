import { Router, type Request, type Response } from "express";
import multer from "multer";
import { b2 } from "../lib/b2Storage";
import { adViewsCol, notesCol } from "../lib/firebase";
import { randomUUID } from "crypto";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post("/storage/uploads", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    const filename = req.file.originalname || `file-${randomUUID()}.pdf`;
    const objectKey = `uploads/${randomUUID()}/${filename}`;
    await b2.putObject(objectKey, req.file.buffer, req.file.mimetype || "application/pdf");
    res.json({ objectPath: objectKey });
  } catch (error) {
    req.log.error({ err: error }, "Error uploading file");
    res.status(500).json({ error: "Failed to upload file" });
  }
});

router.get("/thumbnails/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const objectKey = Array.isArray(raw) ? raw.join("/") : raw;
    const normalizedKey = objectKey.replace(/^\/objects\//, "").replace(/^\//, "");

    const { stream, contentType, contentLength } = await b2.streamObject(normalizedKey);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (contentLength) res.setHeader("Content-Length", String(contentLength));

    stream.pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "Error serving thumbnail");
    res.status(404).json({ error: "Thumbnail not found" });
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const objectKey = Array.isArray(raw) ? raw.join("/") : raw;

    const accessToken = req.headers["x-access-token"] as string | undefined;
    if (!accessToken) {
      res.status(401).json({ error: "Access token required" });
      return;
    }

    const adViewSnap = await adViewsCol()
      .where("accessToken", "==", accessToken)
      .limit(1)
      .get();

    if (adViewSnap.empty) {
      res.status(403).json({ error: "Invalid or expired access token" });
      return;
    }

    const adView = adViewSnap.docs[0].data();
    const expires = adView.expiresAt?.toDate ? adView.expiresAt.toDate() : new Date(adView.expiresAt);
    if (expires <= new Date()) {
      res.status(403).json({ error: "Invalid or expired access token" });
      return;
    }

    const noteDoc = await notesCol().doc(String(adView.noteId)).get();
    if (!noteDoc.exists) {
      res.status(403).json({ error: "Token does not grant access to this file" });
      return;
    }

    const note = noteDoc.data()!;
    const storedRaw = (note.pdfKey || note.pdfPath || "") as string;
    const storedKey = storedRaw.replace(/^\/objects\//, "").replace(/^\//, "");
    const normalizedKey = objectKey.replace(/^\/objects\//, "").replace(/^\//, "");
    if (storedKey !== normalizedKey) {
      res.status(403).json({ error: "Token does not grant access to this file" });
      return;
    }

    const { stream, contentType, contentLength } = await b2.streamObject(normalizedKey);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (contentLength) res.setHeader("Content-Length", String(contentLength));

    stream.pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
