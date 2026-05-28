import { GoogleGenAI, LiveServerMessage } from "@google/genai";

async function test() {
  if (!process.env.GEMINI_API_KEY) return;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const session = await ai.live.connect({
    model: "gemini-3.1-flash-live-preview",
    callbacks: {
       onmessage: (msg: LiveServerMessage) => {
          console.log(JSON.stringify(msg));
          if (msg.serverContent && msg.serverContent.turnComplete) {
             process.exit(0);
          }
       }
    }
  });
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Say "hello"' }] }], turnComplete: true });
}
test();
