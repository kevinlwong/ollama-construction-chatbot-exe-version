const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 120_000);

export async function chatWithFileStream(model, message, file, onMessage) {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("message", message);
  if (file) fd.append("file", file);

  const res = await fetch("http://localhost:5000/chat-with-file", {
    method: "POST",
    body: fd,
    signal: ctrl.signal,
  });
  clearTimeout(timer);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop(); // hold incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        onMessage(json);
      } catch (err) {
        console.warn("Failed to parse NDJSON chunk:", line);
      }
    }
  }
}
