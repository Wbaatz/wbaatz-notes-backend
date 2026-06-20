import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createPrivateKey } from "crypto";

/**
 * Normalize Firebase private key to a valid PEM string.
 * Node.js --env-file already resolves \n to real newlines, but the resulting
 * PEM lines may have inconsistent lengths that OpenSSL 3.x rejects.
 * Round-tripping through DER normalizes the key to a standard 64-char/line PEM.
 */
function normalizePrivateKey(raw: string): string {
  // Strip surrounding quotes if present (from .env quoting)
  const stripped = raw.replace(/^"|"$/g, "");
  // In case the key still has literal \n sequences, replace them
  const withNewlines = stripped.includes("\n") ? stripped : stripped.replace(/\\n/g, "\n");
  // Extract raw base64 body
  const base64 = withNewlines
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, "")
    .replace(/[\n\r]/g, "")
    .trim();
  // Round-trip through DER to get a properly formatted PEM
  const der = Buffer.from(base64, "base64");
  const keyObj = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return keyObj.export({ format: "pem", type: "pkcs8" }) as string;
}

if (!getApps().length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: normalizePrivateKey(privateKey),
      }),
    });
  } else {
    // Fallback for local emulator or default credentials
    initializeApp({
      projectId: projectId || "wbaatz-notes-dev",
    });
  }
}

export const db = getFirestore();

// Collection references
export const notesCol = () => db.collection("notes");
export const adViewsCol = () => db.collection("adViews");
export const settingsCol = () => db.collection("settings");
export const conversationsCol = () => db.collection("conversations");
export const messagesCol = (conversationId: string) =>
  db.collection("conversations").doc(conversationId).collection("messages");
