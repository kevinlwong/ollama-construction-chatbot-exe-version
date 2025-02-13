<template>
    <div class="chat-container">
      <div class="chat-header">Chat with {{ model }}</div>
  
      <!-- Thinking Process (Only Shows When Needed) -->
      <div v-if="displayedThinking && isThinking" class="thinking-process">
        <strong>Thinking:</strong>
        <p>{{ displayedThinking }}</p>
      </div>
  
      <!-- ✅ Chat Messages (Ensuring Chat History is Always Retained) -->
      <div class="chat-messages">
        <div v-for="(msg, index) in messages" :key="index" :class="msg.sender">
          <span class="message-text">{{ msg.text }}</span>
        </div>
      </div>
  
      <!-- Chat Input Box -->
      <div class="chat-input">
        <input
          v-model="userInput"
          placeholder="Type a message..."
          @keyup.enter="sendMessage"
        />
        <button @click="sendMessage">Send</button>
      </div>
    </div>
  </template>
  
  <script>
  export default {
    props: ['model'],
    data() {
      return {
        userInput: '',
        messages: [], // ✅ Chat history is stored properly
        displayedThinking: '', 
        isThinking: false, // ✅ Only shows when DeepSeek provides it
      };
    },
    methods: {
      async sendMessage() {
        if (!this.userInput.trim()) return;
  
        this.messages.push({ sender: 'user', text: this.userInput }); // ✅ Store user message in chat history
        this.displayedThinking = '';
        this.isThinking = false; // ✅ Reset thinking state
  
        try {
          const response = await fetch("http://localhost:5000/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: this.model, message: this.userInput }),
          });
  
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let finalResponse = '';
          let hasThinking = false; // ✅ Track if DeepSeek provides a thinking phase
  
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
  
            const chunk = decoder.decode(value);
            const lines = chunk.trim().split("\n");
  
            lines.forEach((line) => {
              try {
                const parsed = JSON.parse(line);
  
                if (parsed.type === "thinking") {
                  this.isThinking = true; 
                  hasThinking = true; // ✅ Ensure we only show thinking if it exists
                  this.displayThinkingLetterByLetter(parsed.text);
                } else if (parsed.type === "final") {
                  this.isThinking = false;
                  this.displayMessageLetterByLetter(parsed.text);
                }
              } catch (error) {
                console.error("Error parsing streaming data:", error);
              }
            });
          }
  
          // ✅ If no thinking phase was detected, do not display it at all
          if (!hasThinking) {
            this.isThinking = false;
            this.displayedThinking = '';
          }
  
        } catch (error) {
          console.error("Chatbot API error:", error);
          this.messages.push({ sender: 'bot', text: "Error: Couldn't get a response." });
        }
  
        this.userInput = '';
      },
      displayThinkingLetterByLetter(text) {
        let index = 0;
        this.displayedThinking = '';
  
        const interval = setInterval(() => {
          if (index < text.length) {
            this.displayedThinking += text[index];
            index++;
          } else {
            clearInterval(interval);
          }
        }, 30);
      },
      displayMessageLetterByLetter(text) {
        let index = 0;
        let displayedText = '';
  
        const interval = setInterval(() => {
          if (index < text.length) {
            displayedText += text[index];
            if (this.messages.length === 0 || this.messages[this.messages.length - 1].sender !== 'bot') {
              this.messages.push({ sender: 'bot', text: displayedText });
            } else {
              this.messages[this.messages.length - 1].text = displayedText;
            }
            index++;
          } else {
            clearInterval(interval);
          }
        }, 30);
      }
    }
  };
  </script>
  
  <style>
  .chat-container {
    width: 500px;
    margin: auto;
    background: #2e2e2e;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }
  
  .chat-header {
    background: #007bff;
    padding: 10px;
    color: white;
    font-size: 18px;
    text-align: center;
  }
  
  /* ✅ Ensuring Thinking Section Appears Only When Needed */
  .thinking-process {
    background: #333;
    color: #ffc107;
    padding: 10px;
    margin: 10px;
    border-radius: 5px;
    font-style: italic;
    white-space: pre-line;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-height: 200px;
    overflow-y: auto;
  }
  
  /* ✅ Chat History is Retained */
  .chat-messages {
    height: 300px;
    overflow-y: auto;
    padding: 10px;
    background: #1e1e1e;
    color: white;
    border-radius: 5px;
    margin: 10px;
  }
  
  .user {
    text-align: right;
    color: lightblue;
  }
  
  .bot {
    text-align: left;
    color: lightgreen;
  }
  
  .message-text {
    display: inline-block;
    padding: 8px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.1);
    margin: 5px;
  }
  
  .chat-input {
    display: flex;
    padding: 10px;
    background: #333;
  }
  
  .chat-input input {
    flex-grow: 1;
    padding: 10px;
    border: none;
    background: #444;
    color: white;
    border-radius: 5px;
  }
  
  .chat-input button {
    padding: 10px 15px;
    margin-left: 10px;
    background: #007bff;
    color: white;
    border: none;
    cursor: pointer;
  }
  </style>
  