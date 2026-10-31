// Asks Speechify for the same paragraph bare and wrapped in SSML prosody and
// prints each speech mark with the characters it points at in both strings,
// so the offset rule for SSML input can be read off. Bills a few hundred
// characters. Run: SPEECHIFY_API_KEY=... node scripts/probe-ssml.mjs
const key = process.env.SPEECHIFY_API_KEY;
if (!key) throw new Error("SPEECHIFY_API_KEY not set");
const text = process.argv[2] ?? "Tom & Jerry <3 cats, so the city's streets tilt toward a flat-topped backdrop.";
const ssml = `<speak><prosody rate="+50%">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</prosody></speak>`;
const flatten = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === "object") {
    if (node.type === "word") out.push(node);
    flatten(node.chunks, out);
  }
  return out;
};
for (const [label, input] of [["bare", text], ["ssml", ssml]]) {
  const res = await fetch("https://api.speechify.ai/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input, voice_id: "harper_32", model: "simba-3.5", audio_format: "mp3" }),
  });
  const json = await res.json();
  if (!res.ok) { console.log(label, res.status, JSON.stringify(json).slice(0, 300)); continue; }
  const words = flatten(json.speech_marks);
  console.log(`== ${label}: input ${input.length} chars, ${words.length} word marks, top-level start/end ${json.speech_marks.start}/${json.speech_marks.end}`);
  for (const w of words) console.log(`${String(w.start).padStart(4)}-${String(w.end).padEnd(4)} value=${JSON.stringify(w.value)} input=${JSON.stringify(input.slice(w.start, w.end))} text=${JSON.stringify(text.slice(w.start, w.end))}`);
}
