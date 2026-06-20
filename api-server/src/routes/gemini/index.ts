import { Router } from "express";
import { conversationsCol, messagesCol } from "../../lib/firebase";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  CreateGeminiConversationBody,
  SendGeminiMessageBody,
  GetGeminiConversationParams,
  DeleteGeminiConversationParams,
  ListGeminiMessagesParams,
  SendGeminiMessageParams,
} from "@workspace/api-zod";

const router = Router();

const SYSTEM_PROMPT = `You are a helpful study tutor for students preparing for A Level, O Level, and University-level Computer Science exams. 
You help with:
- Explaining CS concepts clearly (algorithms, data structures, programming, networks, databases, etc.)
- Solving past paper questions
- Assignment help and guidance
- Exam tips and study strategies

Be concise, clear, and encouraging. Use examples where helpful. If asked about non-CS topics, gently redirect to CS studies.`;

router.get("/gemini/conversations", async (_req, res) => {
  const snap = await conversationsCol().orderBy("createdAt", "asc").get();
  res.json(snap.docs.map((d) => ({
    id: d.id,
    title: d.data().title,
    createdAt: d.data().createdAt?.toDate ? d.data().createdAt.toDate().toISOString() : d.data().createdAt,
  })));
});

router.post("/gemini/conversations", async (req, res) => {
  const parsed = CreateGeminiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const now = new Date();
  const ref = await conversationsCol().add({ title: parsed.data.title, createdAt: now });
  res.status(201).json({ id: ref.id, title: parsed.data.title, createdAt: now.toISOString() });
});

router.get("/gemini/conversations/:id", async (req, res) => {
  const parsed = GetGeminiConversationParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const convDoc = await conversationsCol().doc(req.params.id).get();
  if (!convDoc.exists) { res.status(404).json({ error: "Conversation not found" }); return; }

  const msgsSnap = await messagesCol(req.params.id).orderBy("createdAt", "asc").get();
  res.json({
    id: convDoc.id,
    title: convDoc.data()!.title,
    createdAt: convDoc.data()!.createdAt?.toDate().toISOString(),
    messages: msgsSnap.docs.map((m) => ({
      id: m.id,
      conversationId: req.params.id,
      role: m.data().role,
      content: m.data().content,
      createdAt: m.data().createdAt?.toDate().toISOString(),
    })),
  });
});

router.delete("/gemini/conversations/:id", async (req, res) => {
  const parsed = DeleteGeminiConversationParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const convDoc = await conversationsCol().doc(req.params.id).get();
  if (!convDoc.exists) { res.status(404).json({ error: "Conversation not found" }); return; }
  await conversationsCol().doc(req.params.id).delete();
  res.status(204).send();
});

router.get("/gemini/conversations/:id/messages", async (req, res) => {
  const parsed = ListGeminiMessagesParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const msgsSnap = await messagesCol(req.params.id).orderBy("createdAt", "asc").get();
  res.json(msgsSnap.docs.map((m) => ({
    id: m.id,
    conversationId: req.params.id,
    role: m.data().role,
    content: m.data().content,
    createdAt: m.data().createdAt?.toDate().toISOString(),
  })));
});

router.post("/gemini/conversations/:id/messages", async (req, res) => {
  const paramsParsed = SendGeminiMessageParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const bodyParsed = SendGeminiMessageBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const convDoc = await conversationsCol().doc(req.params.id).get();
  if (!convDoc.exists) { res.status(404).json({ error: "Conversation not found" }); return; }

  const now = new Date();
  await messagesCol(req.params.id).add({ role: "user", content: bodyParsed.data.content, createdAt: now });

  const msgsSnap = await messagesCol(req.params.id).orderBy("createdAt", "asc").get();
  const history = msgsSnap.docs.map((m) => m.data());

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  const stream = await ai.models.generateContentStream({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
      { role: "model", parts: [{ text: "Understood! I'm ready to help students with CS studies." }] },
      ...history.map((m) => ({
        role: m.role === "assistant" ? "model" as const : "user" as const,
        parts: [{ text: m.content }],
      })),
    ],
    config: { maxOutputTokens: 8192 },
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    }
  }

  await messagesCol(req.params.id).add({ role: "assistant", content: fullResponse, createdAt: new Date() });
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
