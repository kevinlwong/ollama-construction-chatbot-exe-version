const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(cors());

const OLLAMA_PATH = './resources/ollama.exe'; // Adjust this if needed

app.post('/chat', async (req, res) => {
    const { model, message } = req.body;

    console.log("Received request:", { model, message });

    if (!model || !message) {
        return res.status(400).json({ error: "Model and message are required." });
    }

    try {
        const ollamaProcess = spawn(OLLAMA_PATH, ['run', model], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        ollamaProcess.stdin.write(message + "\n");
        ollamaProcess.stdin.end();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Transfer-Encoding', 'chunked');

        let responseBuffer = '';
        let isThinking = false;
        let thinkingProcess = '';

        ollamaProcess.stdout.on('data', (data) => {
            const output = data.toString();
            responseBuffer += output;

            if (output.includes("<think>")) {
                isThinking = true;
                thinkingProcess = '';
            }

            if (isThinking) {
                thinkingProcess += output;
            }

            if (output.includes("</think>")) {
                isThinking = false;
                res.write(JSON.stringify({ type: "thinking", text: thinkingProcess.replace(/<\/?think>/g, '') }) + '\n');
            }
        });

        ollamaProcess.stdout.on('end', () => {
            const cleanedResponse = responseBuffer.replace(/<think>.*?<\/think>/s, '').trim();
            console.log("Final Cleaned Response:", cleanedResponse);
            res.write(JSON.stringify({ type: "final", text: cleanedResponse }) + '\n');
            res.end();
        });

        ollamaProcess.stderr.on('data', (data) => {
            console.error("Ollama Error:", data.toString());
        });

    } catch (error) {
        console.error("Error running Ollama:", error);
        res.status(500).json({ error: "Failed to get a response from Ollama." });
    }
});

app.listen(5000, () => console.log("Server running on http://localhost:5000"));
