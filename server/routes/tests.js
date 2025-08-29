// server/routes/tests.js
import express from "express";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { runPlan } from "../test-runner/runPlan.js";
import { getPlan } from "./prd.js";

export const testsRouter = express.Router();

// memory store demo; swap with DB
const JOBS = new Map(); // jobId -> { planId, projectId, dir, status, results }

testsRouter.post("/plans/:planId/run", async (req, res) => {
  const planId = req.params.planId;
  const planMeta = getPlan(planId);
  if (!planMeta) return res.status(404).json({ ok: false, error: "plan not found" });
  const { plan, projectId } = planMeta;

  const jobId = randomUUID();
  const dir = path.join("artifacts", jobId);
  JOBS.set(jobId, { planId, projectId, dir, status: "running" });
  res.json({ ok: true, jobId });

  // Execute (fire-and-forget within the same process)
  try {
    const results = await runPlan({
      plan,
      project: { id: projectId, baseUrl: req.body?.baseUrl || plan.baseUrl || "" },
      jobDir: dir
    });
    JOBS.set(jobId, { planId, projectId, dir, status: "finished", results });
  } catch (e) {
    JOBS.set(jobId, { planId, projectId, dir, status: "error", error: String(e) });
  }
});

testsRouter.get("/jobs/:jobId", async (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: "not found" });

  let results = job.results;
  if (!results) {
    try {
      const text = await fs.readFile(path.join(job.dir, "results.json"), "utf8");
      results = JSON.parse(text);
    } catch {}
  }

  const video = "run.webm";
  // Collect screenshots
  let screenshots = [];
  try {
    const files = await fs.readdir(job.dir);
    screenshots = files.filter(f => f.endsWith(".png"));
  } catch {}
  res.json({
    ok: true,
    status: job.status,
    planId: job.planId,
    projectId: job.projectId,
    artifacts: {
      video: results ? `/artifacts/${req.params.jobId}/${video}` : null,
      screenshots: screenshots.map(s => `/artifacts/${req.params.jobId}/${s}`)
    },
    results
  });
});

export function getJob(jobId) { return JOBS.get(jobId); }
