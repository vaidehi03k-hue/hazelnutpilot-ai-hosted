// server/index.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

// --- Route modules (keep your existing projects router) ---
import { projectsRouter } from "./routes/projects.js"; // your existing CRUD for /api/projects
import { prdRouter } from "./routes/prd.js";           // PRD upload -> AI -> plan.json
import { testsRouter } from "./routes/tests.js";       // Run plan -> video/screenshots/results

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- Core middleware ---
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// --- Static artifact hosting ---
app.use("/artifacts", express.static(path.join(process.cwd(), "artifacts")));
app.use("/plans", express.static(path.join(process.cwd(), "plans")));

// --- Health check ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", time: new Date().toISOString() });
});

// --- API routes ---
app.use("/api", projectsRouter); // must include: GET /projects, POST /projects, GET/PUT /projects/:id, etc.
app.use("/api", prdRouter);      // POST /projects/:projectId/prd, GET /projects/:projectId/plans, GET /plans/:planId
app.use("/api", testsRouter);    // POST /plans/:planId/run, GET /jobs/:jobId

// --- Not found handler (API only) ---
app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// --- Generic error handler ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

// --- Server bootstrap ---
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`API listening on http://${HOST}:${PORT}`);
});
