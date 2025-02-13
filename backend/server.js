import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(express.json());
app.use(cors());

const OLLAMA_URL = 'http://localhost:11434/api/generate'; // Ollama API URL

app.post('/chat', async (req, res) => {
    const { model, message } = req.body;

    console.log("Received request:", { model, message });

    if (!model || !message) {
        return res.status(400).json({ error: "Model and message are required." });
    }

    try {
        const response = await axios.post(OLLAMA_URL, {
            model: model,
            prompt: message
        }, { responseType: 'stream' });

        let fullResponse = ''; // Store the full response

        response.data.on('data', (chunk) => {
            try {
                const parsedChunk = JSON.parse(chunk.toString());
                if (parsedChunk.response) {
                    fullResponse += parsedChunk.response;
                }
            } catch (error) {
                console.error("Error parsing chunk:", error);
            }
        });

        response.data.on('end', () => {
            console.log("Final Response:", fullResponse);
            res.json({ response: fullResponse }); // Send full message to frontend
        });

    } catch (error) {
        console.error("Error connecting to Ollama:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Failed to get a response from Ollama." });
    }
});

app.listen(5000, () => console.log("Server running on http://localhost:5000"));
