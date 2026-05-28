const { GoogleGenAI } = require("@google/genai");
async function test() {
  const ai = new GoogleGenAI({ apiKey: "none" });
  const session = await ai.live.connect({ model: "gemini-3.1-flash-live-preview" }).catch(e => e);
  console.log(session.send ? "has send" : "no send");
  console.log(Object.keys(Math));
}
test();
