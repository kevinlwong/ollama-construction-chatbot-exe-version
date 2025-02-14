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

        <!-- Final Chatbot Response -->
        <template v-if="msg.type === 'final'">
          <div class="bot-message">{{ msg.text }}</div>
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
    async sendMessage() {
      if (!this.userInput.trim()) return;

      // ✅ Add user message to chat
      this.messages.push({ sender: 'user', text: this.userInput, type: 'user' });

      let isThinking = false;
      let thinkingText = "";
      let finalResponse = "";

      try {
        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: this.userInput }),
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // new addition trying to implement thinking...
        this.messages.push({
          sender: 'bot',
          type: 'thinking',
          text: "Thinking.",
          expanded: true, // Make it always visible while thinking
        });


        // Add a UI animation to update "Thinking..." state
        let dots = 0;
        const thinkingAnimation = setInterval(() => {
          dots = (dots + 1) % 4;
          this.messages[this.messages.length - 1].text = "Thinking" + ".".repeat(dots);
          this.$forceUpdate();
        }, 500); // Updates every 500ms

        ///////// end of new addition

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.trim().split("\n");

          lines.forEach((line) => {
            try {
              const parsed = JSON.parse(line);

              // ✅ Detect start of <think> section
              if (parsed.response.includes("<think>")) {
                isThinking = true;
                thinkingText = ""; // Reset
              }

              // ✅ Collect thinking text until </think>
              if (isThinking) {
                thinkingText += " " + parsed.response.replace(/<\/?think>/g, "").trim();
              }

              // ✅ Detect end of <think> section
              if (parsed.response.includes("</think>")) {
                isThinking = false;

                // ✅ If the thinking section is empty, set a default message
                if (!thinkingText.trim()) {
                  thinkingText = "No thinking phase for this specific question.";
                }

                // this.messages.push({
                //   sender: 'bot',
                //   type: 'thinking',
                //   text: thinkingText,
                //   expanded: false,
                // });

                clearInterval(thinkingAnimation); // Stop "Thinking..." animation

                if (!thinkingText.trim()) {
                  thinkingText = "No thinking phase for this specific question.";
                }

                this.messages[this.messages.length - 1].text = thinkingText.trim();
                this.messages[this.messages.length - 1].expanded = false;

              }

              // ✅ Capture final response after </think>
              else if (!isThinking) {
                finalResponse += parsed.response;
              }

            } catch (error) {
              console.error("Error parsing streaming data:", error);
            }
          });

          this.$forceUpdate();
        }

        // ✅ Display final chatbot response letter by letter
        if (finalResponse.trim()) {
          this.displayMessageLetterByLetter(finalResponse.trim());
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
      let displayedText = "";

      const interval = setInterval(() => {
        if (index < text.length) {
          displayedText += text[index];

          if (
            this.messages.length === 0 ||
            this.messages[this.messages.length - 1].type !== "final"
          ) {
            this.messages.push({
              sender: "bot",
              text: displayedText,
              type: "final",
            });
          } else {
            this.messages[this.messages.length - 1].text = displayedText;
          }
          index++;
        } else {
          clearInterval(interval);
        }
      }, 30);
    },
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
  display: block;
  word-wrap: break-word;
  animation: fadeIn 0.2s ease-in-out;
}

/* Bot response */
.bot-message {
  text-align: left;
  color: lightgreen;
  background: rgba(255, 255, 255, 0.1);
  padding: 10px;
  border-radius: 10px;
  max-width: 80%;
  margin-right: auto;
  margin-bottom: 20px;
  display: block;
  text-align: justify;
  word-wrap: break-word;
  animation: fadeIn 0.3s ease-in-out;
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