/**
 * One-time migration: PostgreSQL → Firestore, Replit Object Storage → Backblaze B2
 * Run with: node migrate-to-firebase.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import pkg from "pg";
const { Pool } = pkg;

// ── Firebase ──────────────────────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const firestoreDb = getFirestore();

// ── Backblaze B2 ──────────────────────────────────────────────────────────────
const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.B2_APPLICATION_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
});
const B2_BUCKET = process.env.B2_BUCKET_NAME;

// ── Replit Object Storage sidecar ─────────────────────────────────────────────
const SIDECAR = "http://127.0.0.1:1106";

async function getSignedDownloadUrl(objectPath) {
  // objectPath like /objects/uploads/<uuid>  →  we need bucket + object name
  // PRIVATE_OBJECT_DIR looks like /bucket-name/some/prefix
  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  // strip leading /objects/ from objectPath
  const entityId = objectPath.replace(/^\/objects\//, "");
  const fullPath = `${privateDir.replace(/\/$/, "")}/${entityId}`;
  const parts = fullPath.replace(/^\//, "").split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");

  const resp = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "GET",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
  });
  if (!resp.ok) throw new Error(`Sidecar error ${resp.status}: ${await resp.text()}`);
  const { signed_url } = await resp.json();
  return signed_url;
}

async function downloadFromReplit(objectPath) {
  const url = await getSignedDownloadUrl(objectPath);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function uploadToB2(key, buffer, contentType = "application/pdf") {
  await s3.send(new PutObjectCommand({
    Bucket: B2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

// ── Migration ─────────────────────────────────────────────────────────────────
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // 1. Check if Firestore already has notes (avoid double migration)
  const existing = await firestoreDb.collection("notes").limit(1).get();
  if (!existing.empty) {
    console.log("⚠️  Firestore already has notes. Skipping migration.");
    await pool.end();
    return;
  }

  // 2. Fetch all notes from PostgreSQL
  const { rows: notes } = await pool.query("SELECT * FROM notes ORDER BY id");
  console.log(`📋 Found ${notes.length} notes to migrate`);

  for (const note of notes) {
    console.log(`\n→ Migrating note #${note.id}: "${note.title}"`);

    // 3. Download PDF from Replit Object Storage
    let b2Key = note.pdf_path;
    try {
      console.log(`  ↓ Downloading PDF from Replit: ${note.pdf_path}`);
      const pdfBuffer = await downloadFromReplit(note.pdf_path);
      // Use the same relative path as B2 key (strip leading /objects/)
      b2Key = note.pdf_path.replace(/^\/objects\//, "");
      console.log(`  ↑ Uploading to B2: ${b2Key}`);
      await uploadToB2(b2Key, pdfBuffer, "application/pdf");
      console.log(`  ✓ PDF migrated to B2`);
    } catch (err) {
      console.warn(`  ⚠️  Could not migrate PDF: ${err.message}. Storing original path.`);
      b2Key = note.pdf_path;
    }

    // 4. Write note to Firestore (use old numeric id as doc id for URL compatibility)
    await firestoreDb.collection("notes").doc(String(note.id)).set({
      title: note.title,
      description: note.description || "",
      subject: note.subject || "General",
      pdfPath: b2Key,
      pdfKey: b2Key,
      thumbnailPath: note.thumbnail_path || null,
      adViewCount: note.ad_view_count || 0,
      createdAt: note.created_at || new Date(),
    });
    console.log(`  ✓ Note saved to Firestore (id: ${note.id})`);
  }

  // 5. Migrate settings
  const { rows: settingsRows } = await pool.query("SELECT * FROM settings LIMIT 1");
  if (settingsRows.length > 0) {
    await firestoreDb.collection("settings").doc("global").set({
      requireAdEveryVisit: settingsRows[0].require_ad_every_visit || false,
    });
    console.log("\n✓ Settings migrated");
  }

  await pool.end();
  console.log("\n🎉 Migration complete!");
}

main().catch((err) => { console.error("Migration failed:", err); process.exit(1); });
