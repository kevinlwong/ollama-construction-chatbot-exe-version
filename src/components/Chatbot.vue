<template>
  <div class="chat-container">
    <div class="chat-header">Chat with {{ model }}</div>

    <!-- Chat Messages -->
    <div class="chat-messages">
      <div v-for="(msg, index) in messages" :key="index" :class="msg.sender">

        <!-- User Message -->
        <template v-if="msg.type === 'user'">
          <div class="message user-message">{{ msg.text }}</div>
        </template>

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

    <!-- Chat Input Box -->
    <div class="chat-input">
      <input v-model="userInput" placeholder="Type a message..." @keyup.enter="sendMessage" />
      <button @click="sendMessage">Send</button>
    </div>
  </div>
</template>


<script>
import { marked } from 'marked';
const { ipcRenderer } = window.require("electron");

export default {
  props: ["model"],
  data() {
    return {
      userInput: "",
      messages: [], // Stores user & final bot messages
      thinkingMessages: [], // Stores separate thinking messages
    };
  },
  methods: {
    // ✅ Convert Markdown response to properly formatted HTML
    renderMarkdown(text) {
      return marked(text);
    },

    async sendMessage() {
      if (!this.userInput.trim()) return;

      // ✅ Add user message to chat
      this.messages.push({ sender: 'user', text: this.userInput, type: 'user' });

      let isThinking = false;
      let finalResponse = "";
      let thinkingText = "";
      let receivedThinkTag = false;
      let thinkingIndex = this.messages.length;
      let thinkingAnimationActive = false;

      // ✅ Add "Thinking..." animation **ONLY IF DeepSeek R1 is Selected**
      if (this.model.includes("deepseek")) {
        this.messages.push({
          sender: 'bot',
          type: 'thinking',
          text: "Thinking.",
          expanded: true, // ✅ Start expanded
        });

        thinkingAnimationActive = true;

        // Thinking animation
        let dots = 0;
        const thinkingAnimation = setInterval(() => {
          if (!thinkingAnimationActive) {
            clearInterval(thinkingAnimation); // ✅ Stop animation when real text starts
            return;
          }
          dots = (dots + 1) % 4;
          this.messages[thinkingIndex].text = "Thinking" + ".".repeat(dots);
          this.$forceUpdate();
        }, 500);
      }

      try {
        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: this.userInput }),
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // ✅ Placeholder for letter-by-letter response
        let botMessageIndex = this.messages.length;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.trim().split("\n");

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);

              if (parsed.response.includes("<think>")) {
                isThinking = true;
                receivedThinkTag = true;
                thinkingText = "";
              }

              if (isThinking) {
                // ✅ Stop "Thinking..." animation when real thinking text starts
                if (thinkingAnimationActive) {
                  thinkingAnimationActive = false;
                }

                let cleanText = parsed.response.replace(/<\/?think>/g, "").trim();
                let words = cleanText.split(/\s+/);

                for (let word of words) {
                  if (word) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    thinkingText += word + " ";
                    if (this.model.includes("deepseek")) {
                      this.messages[thinkingIndex].text = thinkingText.trim();
                      this.$forceUpdate();
                    }
                  }
                }
              }

              if (parsed.response.includes("</think>")) {
                isThinking = false;

                if (!thinkingText.trim()) {
                  thinkingText = "No thinking phase for this specific question.";
                }

                if (this.model.includes("deepseek")) {
                  this.messages[thinkingIndex].text = thinkingText.trim();
                  this.messages[thinkingIndex].expanded = false; // ✅ Collapse, but keep it visible
                }
              }

              // ✅ If no <think> tag was detected, process response letter by letter
              if (!receivedThinkTag) {
                this.displayMessageLetterByLetter(parsed.response, botMessageIndex);
              } else if (!isThinking) {
                this.displayMessageLetterByLetter(parsed.response, botMessageIndex);
              }

            } catch (error) {
              console.error("Error parsing streaming data:", error);
            }
          }
          this.$forceUpdate();
        }

        // ✅ Stop animation (but KEEP the "Thinking..." message visible)
        thinkingAnimationActive = false;
        if (this.model.includes("deepseek")) {
          this.messages[thinkingIndex].expanded = false; // ✅ Collapse thinking phase but do NOT delete it
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

    displayMessageLetterByLetter(text) {
      let index = 0;
      let botMessageIndex = this.messages.findIndex(msg => msg.type === "final");

      // Ensure a bot message entry exists before streaming
      if (botMessageIndex === -1) {
        this.messages.push({
          sender: "bot",
          text: "",
          type: "final",
        });
        botMessageIndex = this.messages.length - 1;
      }

      const words = text.split(/\s+/); // Split text into words
      const delay = 50; // Adjust speed for better readability

      const interval = setInterval(() => {
        if (index < words.length) {
          this.messages[botMessageIndex].text += (index === 0 ? "" : " ") + words[index]; // Preserve spacing
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
/* Chat container */
.chat-container {
  width: 600px;
  margin: auto;
  background: #2e2e2e;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
}

/* Chat header */
.chat-header {
  background: #007bff;
  padding: 12px;
  color: white;
  font-size: 18px;
  text-align: center;
  font-weight: bold;
}

/* Messages container */
.chat-messages {
  height: 400px;
  overflow-y: auto;
  padding: 12px;
  background: #1e1e1e;
  color: white;
  border-radius: 5px;
  margin: 10px;
  display: flex;
  flex-direction: column;
}

/* User messages */
.user-message {
  text-align: right;
  color: lightblue;
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
  color: lightgreen;
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
  background: #444;
  padding: 10px;
  margin: 10px 0;
  border-radius: 5px;
  max-width: 75%;
  margin-right: auto;
  text-align: left;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  word-wrap: break-word;
  overflow-wrap: break-word;
  white-space: pre-line;
}

.thinking-text {
  color: #ffc107;
  font-style: italic;
  white-space: pre-line;
  word-wrap: break-word;
  overflow-wrap: break-word;
  max-height: 200px;
  overflow-y: auto;
  padding: 5px;
  border-radius: 5px;
  text-align: justify;
  background: rgba(255, 255, 255, 0.1);
}

/* Toggle Thinking button */
.toggle-thinking {
  background: #666;
  color: white;
  border: none;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
  border-radius: 5px;
  margin-bottom: 5px;
  transition: background 0.3s ease-in-out;
}

.toggle-thinking:hover {
  background: #007bff;
}

/* Chat input box */
.chat-input {
  display: flex;
  align-items: center;
  padding: 10px;
  background: #333;
  border-top: 1px solid #444;
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
  padding: 12px 16px;
  margin-left: 10px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
}

.chat-input button:hover {
  background: #0056b3;
}

/* Scrollbar for chat messages */
.chat-messages::-webkit-scrollbar {
  width: 8px;
}

.chat-messages::-webkit-scrollbar-track {
  background: #222;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 5px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: #888;
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
</style>
