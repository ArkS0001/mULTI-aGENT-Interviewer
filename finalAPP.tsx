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
    const im = (import.meta as any);
    if (im && im.env) return im.env;
    return undefined;
  } catch (e) {
    return undefined;
  }
}

function getRuntimeEnv(): Record<string, any> {
  const metaEnv = readImportMetaEnvSafely();
  if (metaEnv) return metaEnv;

  if (typeof window !== "undefined") {
    const w = window as any;
    if (w.__ENV && typeof w.__ENV === "object") return w.__ENV;
    if (w._env_ && typeof w._env_ === "object") return w._env_;
    return w;
  }

  return {};
}

const runtimeEnv = getRuntimeEnv();

const GROQ_API_URL: string = (runtimeEnv?.VITE_GROQ_API_URL as string) || DEFAULT_GROQ_API_URL;
const STATIC_API_KEY: string = (runtimeEnv?.VITE_GROQ_API_KEY as string) || "";

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
  const [devApiKey, setDevApiKey] = useState("");
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [lastTestResponse, setLastTestResponse] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = "en-US";
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        handleVoiceInput(transcript);
      };
    }
  }, []);

  function speakText(text: string, onEnd?: () => void) {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onend = () => {
      if (onEnd) onEnd();
    };
    synth.speak(utterance);
  }

  const messagesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  const append = (m: Message) => setMessages((s) => [...s, m]);

  const effectiveApiKey = STATIC_API_KEY || devApiKey;

  async function callGroq(prompt: string, temperature = 0.2, max_tokens = 600) {
    if (!effectiveApiKey) throw new Error("Missing GROQ API key. Set VITE_GROQ_API_KEY at build time or paste a key in Dev API Key.");

    const body = { model: MODEL, prompt, max_tokens, temperature } as any;

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

      speakText("Let's begin the interview. " + followupText, () => {
        recognitionRef.current?.start();
      });
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

      const resp = await callGroq(prompt, 0.2, 400);
      append({ id: uid("a"), role: "assistant", text: resp });
      speakText(resp, () => recognitionRef.current?.start());
    } catch (err: any) {
      append({ id: uid("aerr"), role: "assistant", text: `Error: ${err.message}` });
    } finally {
      setIsThinking(false);
    }
  }

  async function handleUserSubmit() {
    if (!userInput.trim()) return;
    const text = userInput.trim();
    setUserInput("");
    append({ id: uid("u"), role: "user", text });

    setIsThinking(true);
    try {
      const evalPrompt = `You are an interview evaluator. Given the last interview question and the candidate's answer below, provide:\n1) a short score 1-5,\n2) 2-line feedback,\n3) suggested follow-up probe (single sentence) if needed.\n\nConversation:\n${messages.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join("\n")}\nCANDIDATE_ANSWER: ${text}`;

      const evalText = await callGroq(evalPrompt, 0.0, 250);
      append({ id: uid("a"), role: "assistant", text: `EVALUATION:\n${evalText}` });
      speakText(evalText);
    } catch (err: any) {
      append({ id: uid("aerr"), role: "assistant", text: `Error: ${err.message}` });
    } finally {
      setIsThinking(false);
    }
  }

  function handleVoiceInput(transcript: string) {
    setUserInput("");
    append({ id: uid("u"), role: "user", text: transcript });
    handleUserSubmit();
  }

  function runDiagnostics() {
    const lines: string[] = [];
    lines.push(`import.meta.env available: ${readImportMetaEnvSafely() ? "yes" : "no"}`);
    lines.push(`window.__ENV present: ${typeof (window as any).__ENV !== "undefined" ? "yes" : "no"}`);
    lines.push(`Detected GROQ_API_URL: ${GROQ_API_URL}`);
    lines.push(`Static API key present at build/runtime: ${STATIC_API_KEY ? "YES" : "NO"}`);
    lines.push(`Effective API key (static || dev): ${effectiveApiKey ? "YES" : "NO"}`);
    setDiagnostics(lines.join("\n"));
  }

  async function runTestPrompt() {
    if (!effectiveApiKey) {
      setLastTestResponse("No API key configured (set VITE_GROQ_API_KEY or paste a Dev API Key). Test aborted.");
      return;
    }

    setLastTestResponse("Running test prompt — waiting for response...");
    try {
      const resp = await callGroq("Respond with 'groq-test-ok' to confirm connectivity and authentication.", 0.0, 40);
      setLastTestResponse(`OK — response:\n${resp}`);
      speakText(resp);
    } catch (err: any) {
      setLastTestResponse(`Test failed: ${err.message}`);
    }
  }

  return (
    <div className="min-h-screen p-6 bg-gray-900 text-gray-100 font-sans">
      <div className="max-w-4xl mx-auto bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
        <header className="p-4 flex items-start justify-between border-b border-gray-700 gap-4">
          <div>
            <h1 className="text-xl font-semibold">Pihu — Agentic Interview (GROQ)</h1>
            <p className="text-sm text-gray-400">Model: {MODEL} • Agentic interview flow</p>
          </div>

          <div className="flex-shrink-0 text-right">
            <div className="text-xs text-gray-400">Status: {isThinking ? "thinking..." : "idle"}</div>
            <div className="mt-2 text-xs text-gray-300">Dev API Key (paste for local testing)</div>
            <input
              value={devApiKey}
              onChange={(e) => setDevApiKey(e.target.value)}
              className="mt-1 text-xs p-1 rounded bg-gray-900 border border-gray-700 w-72"
              placeholder="paste key here (won't be saved to disk)"
            />
          </div>
        </header>

        <main className="p-4 grid grid-cols-1 gap-4">
          <section className="mb-2">
            <label className="block text-sm text-gray-300 mb-2">Candidate profile (paste resume summary)</label>
            <textarea
              value={candidateProfile}
              onChange={(e) => setCandidateProfile(e.target.value)}
              className="w-full p-2 rounded bg-gray-900 text-gray-100 border border-gray-700"
              rows={4}
              placeholder="e.g. 5 years backend engineer, Node.js, distributed systems, AWS..."
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={startAgenticInterview}
                disabled={!candidateProfile.trim() || isThinking}
                className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
              >
                Start Agentic Interview
              </button>
              <button
                onClick={() => handleAskNext()}
                disabled={isThinking}
                className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"
              >
                Ask Next Question (agent)
              </button>
              <button
                onClick={() => setMessages([])}
                className="px-3 py-1 rounded bg-red-600 hover:bg-red-500"
              >
                Clear Conversation
              </button>
              <button
                onClick={() => recognitionRef.current?.start()}
                className="px-3 py-1 rounded bg-green-700 hover:bg-green-600"
              >
                🎤 Speak
              </button>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-gray-900 rounded border border-gray-700 h-64 overflow-auto" ref={messagesRef as any}>
              {messages.map((m) => (
                <div key={m.id} className={`mb-3 ${m.role === "user" ? "text-right" : "text-left"}`}>
                  <div className="text-xs text-gray-400">{m.role.toUpperCase()}</div>
                  <div className="inline-block mt-1 p-3 rounded-lg bg-gray-800 border border-gray-700 text-sm">
                    {m.text.split("\n").map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-gray-900 rounded border border-gray-700 flex flex-col">
              <div className="mb-2">
                <div className="text-xs text-gray-300 mb-1">Manual input (candidate answer / chat)</div>
                <input
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleUserSubmit();
                  }}
                  className="w-full p-2 rounded bg-gray-900 border border-gray-700"
                  placeholder="Type candidate answer or message. Press Ctrl+Enter to submit."
                />
              </div>

              <div className="mt-auto flex gap-2">
                <button onClick={handleUserSubmit} className="px-4 rounded bg-green-600 hover:bg-green-500">
                  Send
                </button>

                <button onClick={runDiagnostics} className="px-3 py-1 rounded bg-yellow-600 hover:bg-yellow-500 text-xs">
                  Run Diagnostics
                </button>

                <button onClick={runTestPrompt} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs">
                  Run Test Prompt (sends small request)
                </button>
              </div>

              <div className="mt-3 text-xs text-gray-300 whitespace-pre-wrap">
                <strong>Diagnostics:</strong>
                <div className="mt-1 text-xs text-gray-400">{diagnostics ?? "(no diagnostics run yet)"}</div>
                <div className="mt-2 text-xs text-gray-400">Last test response:{"\n"}{lastTestResponse ?? "(no test run yet)"}</div>
              </div>
            </div>
          </section>
        </main>

        <footer className="p-3 text-xs text-gray-500 border-t border-gray-700">
          Notes: For production, host the API key on a secure server-side proxy and do NOT expose keys in client code.
        </footer>
      </div>
    </div>
  );
}
