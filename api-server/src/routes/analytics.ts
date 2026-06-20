import { Router } from "express";
import { GoogleAuth } from "google-auth-library";
import { createPrivateKey } from "crypto";

const router = Router();

function normalizePrivateKey(raw: string): string {
  try {
    const stripped = raw.replace(/^["']|["']$/g, "");
    const withNewlines = stripped.includes("\n") ? stripped : stripped.replace(/\\n/g, "\n");
    const base64 = withNewlines
      .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, "")
      .replace(/[\n\r]/g, "")
      .trim();
    const der = Buffer.from(base64, "base64");
    const keyObj = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return keyObj.export({ format: "pem", type: "pkcs8" }) as string;
  } catch {
    const stripped = raw.replace(/^["']|["']$/g, "");
    return stripped.includes("\n") ? stripped : stripped.replace(/\\n/g, "\n");
  }
}

function getAuth() {
  const rawKey = process.env.GA_PRIVATE_KEY;
  const clientEmail = process.env.GA_CLIENT_EMAIL;
  if (!rawKey || !clientEmail) {
    throw new Error("GA credentials not configured");
  }
  const privateKey = normalizePrivateKey(rawKey);
  return new GoogleAuth({
    credentials: { private_key: privateKey, client_email: clientEmail },
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

async function gaRequest(auth: GoogleAuth, propertyId: string, body: object) {
  const client = await auth.getClient();
  const token = await (client as any).getAccessToken();
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GA API error ${res.status}: ${txt}`);
  }
  return res.json() as Promise<any>;
}

router.get("/analytics", async (req, res) => {
  try {
    const auth = getAuth();
    const propertyId = process.env.GA_PROPERTY_ID || "";
    const [summaryData, countriesData, pagesData, dailyData] = await Promise.all([
      gaRequest(auth, propertyId, {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
        ],
      }),
      gaRequest(auth, propertyId, {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: 10,
      }),
      gaRequest(auth, propertyId, {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      }),
      gaRequest(auth, propertyId, {
        dateRanges: [{ startDate: "13daysAgo", endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "totalUsers" }],
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      }),
    ]);

    const summary = summaryData.rows?.[0]?.metricValues ?? [];
    const totalUsers = parseInt(summary[0]?.value ?? "0");
    const sessions = parseInt(summary[1]?.value ?? "0");
    const pageViews = parseInt(summary[2]?.value ?? "0");
    const avgSessionSec = Math.round(parseFloat(summary[3]?.value ?? "0"));

    const countries = (countriesData.rows ?? []).map((r: any) => ({
      country: r.dimensionValues?.[0]?.value ?? "",
      users: parseInt(r.metricValues?.[0]?.value ?? "0"),
    }));

    const pages = (pagesData.rows ?? []).map((r: any) => ({
      path: r.dimensionValues?.[0]?.value ?? "",
      views: parseInt(r.metricValues?.[0]?.value ?? "0"),
      users: parseInt(r.metricValues?.[1]?.value ?? "0"),
    }));

    const daily = (dailyData.rows ?? []).map((r: any) => {
      const d: string = r.dimensionValues?.[0]?.value ?? "";
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        users: parseInt(r.metricValues?.[0]?.value ?? "0"),
      };
    });

    res.json({ totalUsers, sessions, pageViews, avgSessionSec, countries, pages, daily });
  } catch (err: any) {
    console.error("GA error:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch analytics" });
  }
});

export default router;
