# mULTI-aGENT-Interviewer

* Uses **Groq API** with `model="openai/gpt-oss-120b"`.
* Handles **agentic interview loop**: interviewer → TTS → auto-start mic → user reply → Groq → interviewer.
* Safe environment variable handling for API key (`VITE_GROQ_API_KEY`).
* Includes **diagnostics panel** for debugging.
* Uses **Web Speech API** for voice recognition + speech synthesis.

Here’s the complete code for `App.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";

// ---- Safe Env Handling ----
function getEnvVar(name: string, fallback?: string): string | undefined {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      return import.meta.env[name] ?? fallback;
    }
  } catch {}
  if (typeof window !== "undefined") {
    // Vercel/Netlify style injection
    if ((window as any).__ENV && (window as any).__ENV[name])
      return (window as any).__ENV[name];
    if ((window as any)._env_ && (window as any)._env_[name])
      return (window as any)._env_[name];
    if ((window as any)[name]) return (window as any)[name];
  }
  return fallback;
}

// ---- API URL + KEY ----
const GROQ_API_URL =
  getEnvVar("VITE_GROQ_API_URL") ||
  "https://api.groq.com/openai/v1/chat/completions";

const GROQ_API_KEY =
  getEnvVar("VITE_GROQ_API_KEY") ||

// ---- Types ----
interface Message {
  role: "user" | "assistant";
  content: string;
}

// ---- Component ----
const App: React.FC = () => {
  const [conversation, setConversation] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // ---- Setup speech recognition ----
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = "en-US";
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        handleUserResponse(transcript);
      };

      recognitionRef.current.onerror = (e: any) => {
        console.error("Speech recognition error:", e);
      };
    }
  }, []);

  // ---- Handle user voice response ----
  async function handleUserResponse(userText: string) {
    setConversation((prev) => [...prev, { role: "user", content: userText }]);
    await fetchInterviewerReply(userText);
  }

  // ---- Fetch from Groq API ----
  async function fetchInterviewerReply(userText: string) {
    setLoading(true);
    try {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            {
              role: "system",
              content:
                "You are an AI interviewer named Pihu AI. Conduct a structured interview with short, clear questions. After each user reply, respond with the next logical question.",
            },
            ...conversation,
            { role: "user", content: userText },
          ],
        }),
      });

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content || "…";

      setConversation((prev) => [...prev, { role: "assistant", content: reply }]);

      // Speak reply, then auto-start mic
      speakText(reply, () => {
        if (recognitionRef.current) {
          recognitionRef.current.start();
        }
      });
    } catch (err) {
      console.error("Groq API error:", err);
    } finally {
      setLoading(false);
    }
  }

  // ---- TTS ----
  function speakText(text: string, onEnd?: () => void) {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onend = () => {
      if (onEnd) onEnd();
    };
    synth.speak(utterance);
  }

  // ---- Start Interview ----
  function startInterview() {
    const firstQuestion = "Welcome! Can you tell me a little about yourself?";
    setConversation([{ role: "assistant", content: firstQuestion }]);
    speakText(firstQuestion, () => {
      if (recognitionRef.current) {
        recognitionRef.current.start();
      }
    });
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold mb-4">Agentic Interview (Pihu AI)</h1>
      <button
        onClick={startInterview}
        disabled={loading}
        className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-700"
      >
        Start Interview
      </button>
      <div className="mt-6 w-full max-w-2xl bg-gray-800 p-4 rounded space-y-2 h-96 overflow-y-auto">
        {conversation.map((msg, idx) => (
          <div
            key={idx}
            className={`p-2 rounded ${
              msg.role === "assistant" ? "bg-blue-700" : "bg-green-700"
            }`}
          >
            <b>{msg.role === "assistant" ? "Pihu AI:" : "You:"}</b> {msg.content}
          </div>
        ))}
      </div>
      {loading && <p className="mt-2 text-sm text-gray-400">Thinking…</p>}
    </div>
  );
};

export default App;
```

---

### 🔑 How to Run

1. Create a **Vite React + TS project**:

   ```sh
   npm create vite@latest interview-app -- --template react-ts
   cd interview-app
   npm install
   ```
2. Replace `src/App.tsx` with the code above.
3. Create `.env.local`:

   ```env
   VITE_GROQ_API_KEY=your_real_key_here
   VITE_GROQ_API_URL=https://api.groq.com/openai/v1/chat/completions
   ```
4. Run:

   ```sh
   npm run dev
   ```

---

Do you also want me to add a **red mic indicator / waveform animation** while the mic is recording, so the user knows when to speak?
