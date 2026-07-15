import { promises as fs } from "fs";
import path from "path";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const DATA_DIR = "/tmp/anon-chat-messages";

interface StoredMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

async function getMessages(onion: string): Promise<StoredMessage[]> {
  try {
    const filePath = path.join(DATA_DIR, `${onion}.json`);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveMessage(msg: StoredMessage) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const messages = await getMessages(msg.to);
  messages.push(msg);
  const filePath = path.join(DATA_DIR, `${msg.to}.json`);
  await fs.writeFile(filePath, JSON.stringify(messages));
}

function generateId(): string {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 9) +
    "-" +
    Math.random().toString(36).slice(2, 9)
  );
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
    const { to, from, content, timestamp } = req.body;

    if (!to || !from || !content) {
      return res.status(400).json({ error: "Missing required fields: to, from, content" });
    }

    if (typeof to !== "string" || !to.includes(".onion")) {
      return res.status(400).json({ error: "Invalid recipient onion address" });
    }

    const msg: StoredMessage = {
      id: generateId(),
      from,
      to,
      content,
      timestamp: timestamp || Date.now(),
    };

    await saveMessage(msg);
    return res.status(200).json({ ok: true, id: msg.id });
  }

  if (req.method === "GET") {
    const onion = req.query.onion as string;
    const after = parseInt((req.query.after as string) || "0");

    if (!onion) {
      return res.status(400).json({ error: "Missing 'onion' query parameter" });
    }

    const messages = await getMessages(onion);
    const filtered = messages.filter((m) => m.timestamp > after);

    return res.status(200).json({ messages: filtered });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
