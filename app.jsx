import React, { useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  role: "system" | "assistant" | "user";
  text: string;
};

const MODEL = "openai/gpt-oss-120b";
const DEFAULT_GROQ_API_URL = "https://api.groq.ai/v1/engines/gpt-oss-120b/completions";

// Safe helper: attempt to read import.meta.env without throwing if import.meta is unavailable
function readImportMetaEnvSafely(): Record<string, any> | undefined {
  try {
    // (import.meta as any) might throw in some sandboxed runtimes; wrap in try/catch
    const im = (import.meta as any);
    if (im && im.env) return im.env;
    return undefined;
  } catch (e) {
    return undefined;
  }
}

// Try multiple places where envs might be exposed at runtime.
function getRuntimeEnv(): Record<string, any> {
  const metaEnv = readImportMetaEnvSafely();
  if (metaEnv) return metaEnv;

  if (typeof window !== "undefined") {
    const w = window as any;
    // common runtime injection points: window.__ENV, window._env_, direct keys, etc.
    if (w.__ENV && typeof w.__ENV === "object") return w.__ENV;
    if (w._env_ && typeof w._env_ === "object") return w._env_;
    // Some deployments may attach individual keys directly on window
    return w;
  }

  return {};
}

const runtimeEnv = getRuntimeEnv();

// Resolve API URL + key using a safe read from runtimeEnv with fallback
const GROQ_API_URL: string = (runtimeEnv?.VITE_GROQ_API_URL as string) || (runtimeEnv?.VITE_GROQ_API_URL as string) || DEFAULT_GROQ_API_URL;
const STATIC_API_KEY: string = (runtimeEnv?.VITE_GROQ_API_KEY as string) || (runtimeEnv?.VITE_GROQ_API_KEY as string) || "";

function uid(prefix = "m") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export default function App(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: uid("sys"),
      role: "system",
      text:
        "You are Pihu — an agentic interview assistant that plans, asks context-aware follow-ups, conducts behavioral + technical interview questions, evaluates answers, and provides concise feedback and scores.",
    },
  ]);

  const [candidateProfile, setCandidateProfile] = useState("");
  const [userInput, setUserInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [devApiKey, setDevApiKey] = useState(""); // runtime override for testing
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [lastTestResponse, setLastTestResponse] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  const append = (m: Message) => setMessages((s) => [...s, m]);

  const effectiveApiKey = STATIC_API_KEY || devApiKey;

  async function callGroq(prompt: string, temperature = 0.2, max_tokens = 600) {
    if (!effectiveApiKey) throw new Error("Missing GROQ API key. Set VITE_GROQ_API_KEY at build time or paste a key in Dev API Key.");

    const body = {
      model: MODEL,
      prompt,
      max_tokens,
      temperature,
    } as any;

    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GROQ API error: ${res.status} ${txt}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.text ?? data?.output ?? JSON.stringify(data);
    return String(text);
  }

  // Agentic interview flow
  async function startAgenticInterview() {
    try {
      setIsThinking(true);
      append({ id: uid("u"), role: "user", text: `Start an agentic interview for candidate:\n${candidateProfile}` });

      const planPrompt = `You are an expert interview designer. Given the candidate profile below, produce a short JSON plan with:\n1) role summary (1 line)\n2) 3 follow-up clarifying questions to ask candidate before interview\n3) 6 interview questions (mix of behavioral + technical) with a 1-3 line rubric for each question.\n\nCandidate profile:\n${candidateProfile}`;

      const planText = await callGroq(planPrompt, 0.1, 400);
      append({ id: uid("a"), role: "assistant", text: `PLAN:\n${planText}` });

      const followupsPrompt = `From this plan, extract only the 3 follow-up clarifying questions in a numbered list. Plan was:\n${planText}`;
      const followupText = await callGroq(followupsPrompt, 0.1, 200);
      append({ id: uid("a"), role: "assistant", text: `FOLLOW-UPS:\n${followupText}` });

      append({ id: uid("a"), role: "assistant", text: `I'll ask the follow-ups one by one. Please answer them to continue.` });
    } catch (err: any) {
      append({ id: uid("aerr"), role: "assistant", text: `Error: ${err.message}` });
    } finally {
      setIsThinking(false);
    }
  }

  async function handleAskNext() {
    try {
      setIsThinking(true);
      const prompt = `You are the interviewer. Ask one interview question or follow-up based on the conversation so far. Conversation messages:\n${messages
        .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
        .join("\n")}\nIf the next step is to ask a rubric-based question, include a short rubric after the question separated by \n---\nRubric:`;

      const resp = await callGroq
