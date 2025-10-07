

# Bronco Vision

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-34-blue)](https://www.electronjs.org/)
[![RAG Status](https://img.shields.io/badge/RAG-In%20Development-orange)](https://github.com)

**AI-powered desktop assistant for construction professionals using local LLMs**  
*Query building codes, material specs, and project docs through natural conversation - all processed locally for maximum privacy.*

![App Interface](/screenshots/main.png) *← Add your screenshot here*

## Key Features
- **Natural Language Queries** - Ask construction questions in plain English
- **Local AI Processing** - Runs entirely offline using Ollama's LLMs
- **RAG Document Search** - Intelligent retrieval from uploaded project documents
- **Multi-Project Support** - Organize documents by construction sites
- **Security Protection** - Built-in prompt injection detection and filtering
- **File Processing** - PDF, DOCX, TXT, and image OCR support
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

### Basic Mode
1. Launch the application with `npm run electron:dev`
2. Type your question about:
   - Building codes
   - Material specifications  
   - Project documentation
   - Safety regulations
3. Get instant AI-powered answers

### RAG-Enhanced Mode  
1. Start the enhanced server: `cd backend && npm run start:enhanced`
2. **Project Management**: Create projects for different construction sites
3. **Document Upload**: Upload PDFs, DOCX, TXT files to specific projects
4. **Intelligent Search**: Ask questions and get contextual answers from your documents
5. **Security Protection**: Built-in prompt injection detection and filtering

### New API Endpoints
- `POST /api/projects` - Create construction projects
- `GET /api/projects` - List all projects  
- `POST /upload` - Upload documents with RAG processing (add `project_id`)
- `POST /chat` - Enhanced chat with RAG context (add `project_id`)
- `GET /api/rag/stats` - System statistics
- `POST /api/search` - Direct document search
- `GET /api/security/report` - Security monitoring

## Tech Stack
- **Frontend**: Vue 3 + Vite
- **Desktop Shell**: Electron
- **AI Backend**: Ollama Local LLM
- **Styling**: Font Awesome + Custom CSS
- **Packaging**: Electron Builder

## 🚧 RAG Implementation Roadmap

### Phase 1: Foundation (Week 1) - ✅ COMPLETED
- [x] Project planning and architecture design
- [x] Install dependencies (uuid, lodash, joi)
- [x] Create utility functions (chunking, math, logger)
- [x] Set up JSON-based vector storage
- [x] Basic embedding service integration
- [x] Prompt injection protection system
- [x] Enhanced server with RAG integration

### Phase 2: RAG Core (Week 2) - ✅ COMPLETED
- [x] Implement similarity search and context retrieval
- [x] Project categorization and management
- [x] Enhanced document upload with embedding generation
- [x] Context assembly and prompt enhancement
- [x] API endpoint modifications

### Phase 3: Security Layer (Week 3) - ✅ COMPLETED  
- [x] Prompt injection detection patterns
- [x] Security middleware and rate limiting
- [x] Response filtering and sanitization
- [x] Security logging and monitoring
- [x] Threat detection algorithms

### Phase 4: Frontend & Polish (Week 4)
- [ ] Project selector component
- [ ] Document management interface
- [ ] RAG integration in chat interface
- [ ] Security status monitoring
- [ ] End-to-end testing and optimization

### ✅ RAG Implementation Complete

**Core Features Implemented:**
- **Document Processing**: PDF, DOCX, TXT, image OCR with intelligent chunking
- **Vector Search**: Cosine similarity search with configurable thresholds  
- **Project Management**: Multi-project document organization
- **Context Assembly**: Smart context injection with length limits
- **Embedding Service**: Local Ollama `nomic-embed-text` integration
- **Security Layer**: Comprehensive prompt injection protection
- **API Integration**: Enhanced endpoints with backward compatibility

**Technical Architecture:**
- **Local-First**: All processing done locally, no external APIs
- **JSON Storage**: Lightweight vector database in local JSON files (`/backend/data/`)
- **Ollama Integration**: Uses `nomic-embed-text` for embeddings
- **Modular Design**: RAG and security features are optional and removable
- **Zero Breaking Changes**: Existing functionality remains intact
- **Security**: Rate limiting, input validation, threat detection
- **Logging**: Comprehensive activity and performance monitoring

**File Structure Added:**
```
backend/
├── services/          # RAG core services
├── utils/            # Chunking, math, logging utilities  
├── middleware/       # Security and request handling
├── data/            # JSON vector store and projects
└── server-enhanced.cjs # New RAG-enabled server
```

---

## 🛠️ Troubleshooting

If running `npm run electron:build` fails:
1. Delete the `dist_electron` folder
2. Run `npm run electron:build` again
3. This creates a fresh package without conflicting with existing executables

The `dist_electron` folder is just the packaged application and can be safely deleted without affecting source code.


npm run clean
npm run electron:build

then in a separate terminal in vscode
npm run start:enhanced (for the 5000 server and rag services)
keep in mind it is still slow and laggy due to sizes of prompts and embedded data compared to hardware and network speeds

open ollama chatbot setup.exe

click on a model
click on a project
ask question
wait