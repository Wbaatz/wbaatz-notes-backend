import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// CORS configuration - restrict to Vercel frontend only
const rawAllowedOrigin = process.env.CORS_ORIGIN || "https://wbaatz-notes.vercel.app";
const ALLOWED_ORIGINS = rawAllowedOrigin
  .split(",")
  .map((o) => o.trim().replace(/^["']|["']$/g, "").replace(/\/$/, ""))
  .filter(Boolean);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps, curl, or direct server-to-server requests)
    if (!origin) {
      return callback(null, true);
    }
    
    const normalizedOrigin = origin.trim().replace(/\/$/, "");

    // Check if normalizedOrigin matches any in the ALLOWED_ORIGINS list
    const isAllowed = ALLOWED_ORIGINS.some((allowed) => normalizedOrigin === allowed);

    // Also allow any .vercel.app subdomain for easier deployment
    const isVercel = normalizedOrigin.endsWith(".vercel.app") || normalizedOrigin.includes(".vercel.app");

    if (isAllowed || isVercel) {
      callback(null, true);
    } else {
      logger.info({ origin, allowedOrigins: ALLOWED_ORIGINS }, "CORS mismatch");
      callback(null, false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors(corsOptions));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root health check endpoint for Render / uptime monitoring
app.get("/", (_req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.use("/api", router);

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "production" ? "An unexpected error occurred" : err.message,
  });
});

export default app;

