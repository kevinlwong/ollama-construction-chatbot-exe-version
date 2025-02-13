<template>
    <div class="chat-container">
      <div class="chat-header">Chat with {{ model }}</div>
  
      <div class="chat-messages">
        <div v-for="(msg, index) in messages" :key="index" :class="msg.sender">
          <span class="message-text">{{ msg.text }}</span>
        </div>
      </div>
  
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
  import { sendMessageToOllama } from '../services/ollamaApi';
  
  export default {
    props: ['model'], // Receives the active model from App.vue
    data() {
      return {
        userInput: '',
        messages: []
      };
    },
    methods: {
      async sendMessage() {
        if (!this.userInput.trim()) return;
  
        this.messages.push({ sender: 'user', text: this.userInput });
  
        try {
          const response = await sendMessageToOllama(this.model, this.userInput);
          this.messages.push({ sender: 'bot', text: response.response });
        } catch (error) {
          this.messages.push({ sender: 'bot', text: "Error: Couldn't get a response." });
        }
  
        this.userInput = '';
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
  
  .chat-messages {
    height: 300px;
    overflow-y: auto;
    padding: 10px;
    background: #1e1e1e;
    color: white;
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
  