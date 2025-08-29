// server/routes/prd.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { extractText } from "../utils/extract-text.js";
import { buildPrdPrompt } from "../ai/prompts.js";
import { callLLM, SYSTEM_PROMPT } from "../ai/llm.js";
import { randomUUID } from "crypto";

const upload = multer({ dest: "uploads/" });
export const prdRouter = express.Router();

// in-memory for demo; swap with DB as needed
const PLANS = new Map(); // planId -> { projectId, plan, fileName, createdAt }

prdRouter.post("/projects/:projectId/prd", upload.single("file"), async (req, res) => {
  const { projectId } = req.params;
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "file missing" });

  try {
    // TODO: replace with your project fetch
    const project = { id: projectId, name: `Project ${projectId}`, baseUrl: req.body.baseUrl || "" };

    const prdText = await extractText(file.path);
    const prompt = buildPrdPrompt({ prdText, project });
    const plan = await callLLM({ system: SYSTEM_PROMPT, prompt });

    const planId = randomUUID();
    const planDir = path.join("plans", planId);
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(path.join(planDir, "plan.json"), JSON.stringify(plan, null, 2));

    PLANS.set(planId, { projectId, plan, fileName: file.originalname, createdAt: new Date().toISOString() });

    res.json({ ok: true, planId, plan });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    // cleanup temp file
    if (file?.path) { try { await fs.unlink(file.path); } catch {} }
  }
});

prdRouter.get("/projects/:projectId/plans", async (req, res) => {
  const { projectId } = req.params;
  const items = [...PLANS.entries()]
    .filter(([_, v]) => v.projectId === projectId)
    .map(([id, v]) => ({ id, fileName: v.fileName, createdAt: v.createdAt, suiteName: v.plan.suiteName }));
  res.json({ ok: true, plans: items });
});

prdRouter.get("/plans/:planId", async (req, res) => {
  const v = PLANS.get(req.params.planId);
  if (!v) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, plan: v.plan, projectId: v.projectId });
});

export function getPlan(planId) { return PLANS.get(planId); }
