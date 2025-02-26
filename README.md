Here's a polished README for your Ollama Construction Chatbot based on the context provided. I'll use **placeholders** where I made assumptions, which you should customize:


# Ollama Construction Chatbot

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-34-blue)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**AI-powered desktop assistant for construction professionals using local LLMs**  
*Query building codes, material specs, and project docs through natural conversation - all processed locally for maximum privacy.*

![App Interface](/screenshots/main.png) *← Add your screenshot here*

## Key Features
- **Natural Language Queries** - Ask construction questions in plain English
- **Local AI Processing** - Runs entirely offline using Ollama's LLMs
- **Markdown Support** - Beautifully formatted code references & material specs
- **Cross-Platform** - Windows/macOS/Linux compatible
- **Project History** - Save and recall previous conversations

## System Requirements
- Node.js 18+
- Ollama installed locally ([installation guide](https://ollama.ai/))
- Minimum 16GB RAM (for local LLM operation)
- Recommended: NVIDIA/AMD GPU with 8GB+ VRAM

## Installation


# Clone repository
git clone https://github.com/kevinlwong/ollama-construction-chatbot-exe-version.git

# Install dependencies
npm install

# Start development mode
npm run electron:dev

# Build production executable
npm run electron:build


## 🔧 Configuration

1. **Ollama Setup**  
   Download your preferred construction-focused model:
  
   ollama pull llama2:13b
   

2. **Environment Variables**  
   Create `.env` in project root:
   ```
   OLLAMA_MODEL=llama2:13b
   OLLAMA_ENDPOINT=http://localhost:11434
   ```


## Usage
1. Launch the application
2. Type your question about:
   - Building codes
   - Material specifications
   - Project documentation
   - Safety regulations
3. Get instant AI-powered answers with citations

## Tech Stack
- **Frontend**: Vue 3 + Vite
- **Desktop Shell**: Electron
- **AI Backend**: Ollama Local LLM
- **Styling**: Font Awesome + Custom CSS
- **Packaging**: Electron Builder

---

If running npm electron:build does not work or has errors. Try deleting dist_electron folder and run npm run electron:build again as this will create a new dist_electron folder anyways, nad it will not delete any source code. Dist_electron is just the pacakage for the exe application.
