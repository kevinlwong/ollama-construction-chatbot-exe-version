import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(express.json());
app.use(cors());

const OLLAMA_URL = 'http://localhost:11434/api/generate';

app.post('/chat', async (req, res) => {
    const { model, message } = req.body;

    console.log("Received request:", { model, message });

    if (!model || !message) {
        return res.status(400).json({ error: "Model and message are required." });
    }

    try {
        const response = await axios.post(OLLAMA_URL, {
            model: model,
            // prompt: `Think carefully before answering. If you think before responding, wrap your thought process inside <think>...</think>. Otherwise, just respond directly in English.\n\nUser: ${message}`
            prompt: message
        }, { responseType: 'stream' });

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Transfer-Encoding', 'chunked');

        let fullResponse = '';
        let thinkingProcess = '';
        let isThinking = false;
        let hasThinking = false; // ✅ Tracks whether <think> appears

        response.data.on('data', (chunk) => {
            try {
                const parsedChunk = JSON.parse(chunk.toString());

                if (parsedChunk.response) {
                    fullResponse += parsedChunk.response;

                    // Detect <think> tag and extract the thinking process
                    if (parsedChunk.response.includes("<think>")) {
                        isThinking = true;
                        hasThinking = true; // ✅ Set flag that thinking exists
                        thinkingProcess = ''; // Reset thinking buffer
                    }

                    if (isThinking) {
                        thinkingProcess += parsedChunk.response;
                    }

                    if (parsedChunk.response.includes("</think>")) {
                        isThinking = false;
                        res.write(JSON.stringify({ type: "thinking", text: thinkingProcess.replace(/<\/?think>/g, '') }) + '\n');
                    }
                }
            } catch (error) {
                console.error("Error parsing chunk:", error);
            }
        });

        response.data.on('end', () => {
            const cleanedResponse = fullResponse.replace(/<think>.*?<\/think>/s, '').trim();
            console.log("Final Cleaned Response:", cleanedResponse);

            if (!hasThinking) {
                console.log("No <think> section detected. Skipping thinking phase.");
            }

            res.write(JSON.stringify({ type: "final", text: cleanedResponse }) + '\n');
            res.end();
        });

    } catch (error) {
        console.error("Error connecting to Ollama:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Failed to get a response from Ollama." });
    }
});

app.listen(5000, () => console.log("Server running on http://localhost:5000"));
