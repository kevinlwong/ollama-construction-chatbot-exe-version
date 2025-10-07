<template>
    <div class="chat-container">
        <div class="chat-header">How can I help?</div>

        <!-- Chat Messages -->
        <div class="chat-messages">
            <div v-for="(msg, index) in messages" :key="index" :class="msg.sender">

                <!-- User Message -->
                <template v-if="msg.type === 'user'">
                    <div class="message-text message user-message">{{ msg.text }}</div>
                </template>

                <!-- from the web version -->
                <!-- <template v-else>
          <span class="message-text">{{ msg.text }}</span>  this is the user message-->
                <!-- </template> -->

                <!-- Thinking Phase (Stored Separately) -->
                <template v-if="msg.type === 'thinking'">
                    <div class="thinking-message">
                        <button class="toggle-thinking" @click="toggleThinking(index)">
                            {{ msg.expanded ? 'Hide Thinking' : 'Show Thinking' }}
                        </button>
                        <p v-if="msg.expanded" class="thinking-text">{{ msg.text }}</p>
                    </div>
                </template>



                <!-- Final Chatbot Response (Markdown Supported) -->
                <template v-if="msg.type === 'final'">
                    <div class="bot-message">
                        <p v-if="msg.text.includes('```')">
                            <span v-html="renderMarkdown(msg.text)"></span>
                        </p>
                        <p v-else v-html="renderMarkdown(msg.text)"></p>
                    </div>
                </template>


            </div>
        </div>

        <!-- Project Selector -->
        <div class="project-selector">
            <label>Project Context:</label>
            <select v-model="selectedProject">
                <option value="test-project">Test Project (Safety Protocol)</option>
                <option value="olympic-hill">Downtown Olympic/Hill</option>
                <option value="highland-park">Highland Park Residential</option>
                <option value="santa-monica-expansion">Santa Monica Expansion</option>
                <option value="">No Project (General Chat)</option>
            </select>
        </div>

        <!-- Chat Input Box -->
        <div class="chat-input">
            <FileDropUploader :key="uploaderKey" @file-selected="onFileSelected" />

            <textarea v-model="userInput" placeholder="Ask Bronco Vision" @keyup.enter="sendMessage"
                @keydown.enter.prevent="sendMessage"></textarea>
            <button @click="sendMessage">Send</button>
        </div>
    </div>
</template>


<script>
import { marked } from 'marked';
import FileDropUploader from './FileDropUploader.vue';
import { chatWithFileStream } from '@/services/fileChatService.js';
// const { ipcRenderer } = window.require("electron");
let ipcRenderer = null;
if (typeof window !== 'undefined' && window.require) {
    try {
        ipcRenderer = window.require('electron').ipcRenderer;
    } catch (e) {
        console.warn('Electron ipcRenderer not available');
    }
}

export default {
    props: ["model"],
    components: { FileDropUploader },
    data() {
        return {
            userInput: "",
            messages: [], // Stores user & final bot messages
            file: null,
            thinkingMessages: [], // Stores separate thinking messages
            finalMessageBuffer: '',
            isProcessingFinal: false,
            uploaderKey: 0,
            selectedProject: 'olympic-hill', // Default to Olympic Hill project
            availableProjects: [],
        };
    },
    methods: {
        //  Convert Markdown response to properly formatted HTML
        renderMarkdown(text) {
            return marked(text);
        },
        onFileSelected(file) {
            this.file = file;
        },

        async sendMessage() {
            if (!this.userInput.trim()) return;

            const messageToSend = this.userInput;
            console.log(messageToSend);
            this.userInput = "";

            // Add user message to chat
            this.messages.push({ sender: 'user', text: messageToSend, type: 'user' });

            // ------------------------------------------------------------
            // 1) FILE MODE: if a file is attached, use /chat-with-file and stream NDJSON
            // ------------------------------------------------------------
            if (this.file) {
                console.log("[sendMessage] Detected file, kicking off chatWithFileStream", this.file.name);
                const thinkingIndex = this.messages.length;
                this.messages.push({
                    sender: 'bot',
                    type: 'thinking',
                    text: 'Thinking...',
                    expanded: true,
                });

                let finalIndex = -1;

                try {
                    console.log("[sendMessage] calling chatWithFileStream");
                    await chatWithFileStream(this.model, messageToSend, this.file, (parsed) => {
                        if (parsed.type === 'status') {
                            this.messages[thinkingIndex].text = parsed.text
                            return
                        }

                        if (parsed.type === 'thinking') {
                            this.messages[thinkingIndex].text = parsed.text;
                            this.$forceUpdate();
                        } else if (parsed.type === 'final') {
                            this.messages[thinkingIndex].expanded = false;

                            // Create a final message and animate the typewriter, same as your normal path
                            this.messages.push({
                                sender: 'bot',
                                text: '',
                                type: 'final',
                            });
                            finalIndex = this.messages.length - 1;
                            this.finalMessageBuffer = parsed.text;
                            if (!this.isProcessingFinal) {
                                this.processFinalMessage(finalIndex);
                            }
                        }
                    });
                    console.log("[sendMessage] chatWithFileStream returned");
                } catch (err) {
                    console.error('chat-with-file error:', err);
                    this.messages.push({ sender: 'bot', text: "Error: Couldn't get a response from chat-with-file.", type: 'final' });
                } finally {
                    this.file = null; // clear file after use
                    this.uploaderKey++;
                }

                return; // IMPORTANT: stop here, do NOT run the fallback path
            }

            // ------------------------------------------------------------
            // 2) NO FILE: keep your original /api/generate streaming logic
            // ------------------------------------------------------------

            let isThinking = false;
            let finalIndex = -1; // We'll create a new "final" message as needed
            let finalResponse = "";
            let thinkingText = "";
            let receivedThinkTag = false;
            let thinkingIndex = this.messages.length;
            let thinkingAnimationActive = false;

            //  Add "Thinking..." animation **ONLY IF DeepSeek R1 is Selected**
            if (this.model.includes("deepseek")) {
                this.messages.push({
                    sender: 'bot',
                    type: 'thinking',
                    text: "Thinking.",
                    expanded: true, //  Start expanded
                });

                thinkingAnimationActive = true;

                // Thinking animation
                let dots = 0;
                const thinkingAnimation = setInterval(() => {
                    if (!thinkingAnimationActive) {
                        clearInterval(thinkingAnimation); //  Stop animation when real text starts
                        return;
                    }
                    dots = (dots + 1) % 4;
                    this.messages[thinkingIndex].text = "Thinking" + ".".repeat(dots);
                    this.$forceUpdate();
                }, 500);
            }

            try {
                // Use enhanced backend with RAG support instead of direct Ollama
                console.log('[Chat] Sending message with project_id:', this.selectedProject);
                const response = await fetch("http://localhost:5000/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: this.model,
                        message: messageToSend,
                        project_id: this.selectedProject || null
                    }),
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                // let botMessageIndex = this.messages.length;
                finalIndex = -1;

                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    buffer += chunk;
                    
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep the incomplete line in buffer

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line);
                            
                            // Handle enhanced backend response format
                            if (parsed.type === 'status') {
                                // Status message from enhanced backend
                                continue;
                            } else if (parsed.type === 'thinking') {
                                // Thinking phase
                                if (thinkingIndex !== -1) {
                                    this.messages[thinkingIndex].text = parsed.text;
                                    this.$forceUpdate();
                                }
                                if (thinkingAnimationActive) {
                                    thinkingAnimationActive = false;
                                }
                                continue;
                            } else if (parsed.type === 'final') {
                                // Final response
                                if (finalIndex === -1) {
                                    this.messages.push({
                                        sender: "bot",
                                        text: "",
                                        type: "final",
                                    });
                                    finalIndex = this.messages.length - 1;
                                }
                                this.finalMessageBuffer += parsed.text;
                                if (!this.isProcessingFinal) {
                                    this.processFinalMessage(finalIndex);
                                }
                                continue;
                            }
                            
                            // Fallback: handle old Ollama format for compatibility
                            if (parsed.response !== undefined) {
                                if (parsed.response.includes("<think>")) {
                                    isThinking = true;
                                    receivedThinkTag = true;
                                    thinkingText = "";
                                }

                                if (isThinking) {
                                    const snippet = parsed.response.replace(/<\/?think>/g, "").trim();
                                    if (thinkingIndex !== -1) {
                                        thinkingText += (thinkingText ? " " : "") + snippet;
                                        this.messages[thinkingIndex].text = thinkingText;
                                        this.$forceUpdate();
                                    }
                                    if (thinkingAnimationActive) {
                                        thinkingAnimationActive = false;
                                    }
                                }

                                if (parsed.response.includes("</think>")) {
                                    isThinking = false;

                                    if (!thinkingText.trim()) {
                                        this.messages[thinkingIndex].text = "No thinking phase for this question.";
                                    }
                                    this.messages[thinkingIndex].expanded = false;

                                    if (this.model.includes("deepseek")) {
                                        this.messages[thinkingIndex].text = thinkingText.trim();
                                        this.messages[thinkingIndex].expanded = false;
                                    }
                                }

                                // If we are no longer in <think>, the text is "final"
                                if (!isThinking) {
                                    if (finalIndex === -1) {
                                        this.messages.push({
                                            sender: "bot",
                                            text: "",
                                            type: "final",
                                        });
                                        finalIndex = this.messages.length - 1;
                                    }
                                    this.finalMessageBuffer += parsed.response;
                                    if (!this.isProcessingFinal) {
                                        this.processFinalMessage(finalIndex);
                                    }
                                }
                            }
                        } catch (error) {
                            console.error("Error parsing streaming data:", error);
                        }
                    }
                    this.$forceUpdate();
                }
            } catch (error) {
                console.error("Chatbot API error:", error);
                this.messages.push({ sender: 'bot', text: "Error: Couldn't get a response.", type: 'final' });
            }

            this.userInput = '';
        }
        ,

        toggleThinking(index) {
            if (this.messages[index]) {
                this.messages[index].expanded = !this.messages[index].expanded;
                this.$forceUpdate();
            }
        },

        processFinalMessage(finalIndex) {
            this.isProcessingFinal = true;
            const processNextChar = () => {
                if (this.finalMessageBuffer.length > 0) {
                    // Add first character and update
                    const char = this.finalMessageBuffer[0];
                    this.messages[finalIndex].text += char;
                    this.finalMessageBuffer = this.finalMessageBuffer.slice(1);
                    this.$forceUpdate();

                    // Continue processing after delay
                    setTimeout(processNextChar, 50);
                } else {
                    this.isProcessingFinal = false;
                }
            };
            processNextChar();
        },

        // 6) Slightly revised letter-by-letter to accept an explicit finalIndex
        displayMessageLetterByLetter(text, finalIndex) {
            // Just skip if empty chunk
            if (!text.trim()) return;

            // We'll go char-by-char or word-by-word. Let's do char-by-char:
            const chars = text.split("");
            let i = 0;

            // Make sure there's actually a final message for us
            if (!this.messages[finalIndex]) {
                this.messages.push({ sender: "bot", text: "", type: "final" });
                finalIndex = this.messages.length - 1;
            }

            const words = text.split(/\s+/); // Split text into words
            const delay = 50; // Adjust speed for better readability
            const interval = setInterval(() => {
                if (index < words.length) {
                    this.messages[finalIndex].text += (index === 0 ? "" : " ") + words[index]; // Preserve spacing
                    this.$forceUpdate();
                    index++;
                } else {
                    clearInterval(interval);
                }
            }, delay);
        }
        ,



    },
};
</script>


<style>
/* @font-face {
  font-family: 'Inter';
  src: url('@/assets/fonts/inter.woff2') format('woff2');
}

@font-face {
  font-family: 'Roboto';
  src: url('@/assets/fonts/roboto.woff2') format('woff2');
} */

/* Chat container */
.chat-container {
    width: 1200px;
    margin: auto;
    max-width: 1200px;
    min-width: 320px;
    background: #fff;
    /* flex-direction: column; */
    /* border-radius: 10px; */
    overflow: hidden;
}

.chat-header {
    background: white;
    padding: 10px;
    color: #646464;
    font-size: 40px;
    font-family: 'Inter', sans-serif;
    text-align: center;
}

/* Chat Messages */
.chat-messages {
    height: 400px;
    overflow-y: auto;
    padding: 10px;
    background: #fff;
    color: white;
    border-radius: 5px;
    margin: 10px;
}

/* User messages */
.user-message {
    text-align: right;
    color: rgb(34, 145, 182);
    background: rgba(255, 255, 255, 0.1);
    padding: 10px;
    border-radius: 10px;
    max-width: 60%;
    margin-left: auto;
    margin-bottom: 20px;
    display: block;
    word-wrap: break-word;
    animation: fadeIn 0.2s ease-in-out;
}

/* Bot message (Markdown properly formatted) */
.bot-message {
    text-align: left;
    color: rgb(48, 154, 48);
    background: rgba(255, 255, 255, 0.1);
    padding: 12px;
    border-radius: 10px;
    max-width: 85%;
    margin-right: auto;
    display: block;
    text-align: justify;
    word-wrap: break-word;
    animation: fadeIn 0.3s ease-in-out;
}

/* Properly format Markdown inside messages */
.bot-message h1,
.bot-message h2,
.bot-message h3 {
    color: #34eb98;
    /* Green headers */
    margin-bottom: 8px;
}

.bot-message p {
    margin-bottom: 8px;
}

.bot-message ul {
    padding-left: 20px;
}

.bot-message li {
    margin-bottom: 6px;
}

/* Code blocks */
.bot-message pre {
    background: #1a1a1a;
    padding: 10px;
    border-radius: 5px;
    overflow-x: auto;
}

.bot-message code {
    color: #ffcc00;
    background: rgba(255, 255, 255, 0.1);
    padding: 2px 4px;
    border-radius: 3px;
}


/* Thinking Message Styling */
.thinking-message {
    background: #fff;
    padding: 10px;
    margin: 10px 0;
    border-radius: 5px;
    color: #646464;
    width: fit-content;
}

.thinking-text {
    color: #87afff;
    font-style: italic;
    white-space: pre-line;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-height: 200px;
    overflow-y: auto;
}

/*  Toggle Button */
.toggle-thinking {
    background: #fff;
    color: #646464;
    border: none;
    padding: 5px 10px;
    cursor: pointer;
    font-size: 12px;
    border-radius: 8px;
    margin-bottom: 5px;
    outline: none;
    transition: all 0.3s ease-in-out;
}

.toggle-thinking:hover {
    background: #646464;
    color: #fff;
    transition: all 0.3s ease-in-out;
    box-shadow: 0 6px 10px rgba(0, 0, 0, 0.5);
    /* Stronger shadow */
    border: none;
}

.toggle-thinking:active {
    transform: scale(0.95);
}

.toggle-thinking:focus {
    outline: none;
}

/* Project selector */
.project-selector {
    padding: 10px;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
}

.project-selector label {
    color: #646464;
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    margin-right: 10px;
}

.project-selector select {
    padding: 8px 12px;
    border: 1px solid #646464;
    border-radius: 5px;
    background: #fff;
    color: #646464;
    font-family: 'Inter', sans-serif;
    outline: none;
    cursor: pointer;
}

.project-selector select:hover {
    border-color: #34eb98;
}

.project-selector select:focus {
    border-color: #34eb98;
    box-shadow: 0 0 5px rgba(52, 235, 152, 0.3);
}

/* Chat input box */
.chat-input {
    display: flex;
    padding: 10px;
    background: #fff;
    outline: none;
    align-items: center;
    gap: 10px;
}

.chat-input textarea {
    flex-grow: 1;
    /* min-width: 200px; */
    /* max-width: 100%; */
    text-align: left;
    padding: 10px;
    border: 1px solid #646464;
    background: #fff;
    color: #646464;
    border-radius: 45px;
    outline: none;
    font-family: 'Inter', sans-serif;
    font-size: large;
    /* overflow-wrap: break-word; */
    align-content: baseline;
    resize: vertical;
    max-height: 150px;
    min-height: 43.2px;
}

.chat-input textarea:placeholder-shown {
    align-content: center;
}

.chat-input input {
    flex-grow: 1;
    padding: 12px;
    border: none;
    background: #444;
    color: white;
    border-radius: 5px;
    outline: none;
    font-size: 16px;
}

.chat-input button {
    width: 80px;
    height: 64.8px;
    padding: 12px 20px;
    margin-left: 10px;
    background: #fff;
    color: #646464;
    border: 1px solid #646464;
    border-radius: 50px;
    cursor: pointer;
    outline: none;
    transition: all 0.3s ease-in-out;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    display: flex;
    font-family: 'Inter', sans-serif;
}

.chat-input button:hover {
    background: #646464;
    color: #fff;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5);

}

/* Scrollbar for chat messages */
.chat-messages::-webkit-scrollbar {
    width: 8px;
}

.chat-messages::-webkit-scrollbar-track {
    background: #9d9d9d;
}

.chat-messages::-webkit-scrollbar-thumb {
    background: #717171;
    border-radius: 5px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
    background: #c2c2c2;
}

/* Fade-in animation */
@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(5px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Responsive Design */
@media (max-width: 1320px) {
    .chat-container {
        width: 900px;
    }

    .chat-header {
        font-size: 36px;
    }

    .chat-messages {
        height: 500px;
    }

    .chat-input input {
        padding: 10px;
    }

    .chat-input button {
        padding: 10px 15px;
    }
}

/* Responsive Design */
@media (max-width: 1024px) {
    .chat-container {
        width: 650px;
    }

    .chat-header {
        font-size: 30px;
    }

    .chat-messages {
        height: 450px;
    }

    .chat-input textarea {
        padding: 10px;
        font-size: medium;
    }

    .chat-input button {
        padding: 10px 15px;
        font-size: medium;
    }
}

@media (max-width: 768px) {
    .chat-container {
        width: 350px;
    }

    .chat-header {
        font-size: 22px;
        padding: 15px;
    }

    .chat-messages {
        height: 300px;
        font-size: small;
    }

    .chat-input input {
        padding: 8px;
        font-size: 14px;
    }

    .chat-input textarea {
        font-size: small;
    }

    .chat-input button {
        padding: 8px 12px;
        font-size: small;
    }
}

@media (max-width: 480px) {
    .chat-container {
        width: 100%;
        border-radius: 0;
    }

    .chat-header {
        font-size: 20px;
    }

    .chat-messages {
        height: 180px;
        padding: 5px;
    }

    .chat-input {
        flex-direction: column;
        gap: 5px;
    }

    .chat-input input {
        width: 100%;
        padding: 8px;
    }

    .chat-input button {
        width: 100%;
        padding: 8px;
    }
}
</style>