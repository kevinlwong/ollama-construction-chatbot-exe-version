# Olympic Hill RAG System Not Working in Packaged EXE - Root Cause Analysis

## 🔴 Critical Issues Found

### Issue #1: ❌ **Project ID Mismatch in Frontend**
**Location:** `src/components/Chatbot.vue:50`

**Current Code:**
```vue
<option value="downtown-olympic">Downtown Olympic/Hill</option>
```

**Problem:**
- Frontend sends `project_id: "downtown-olympic"`
- But Olympic Hill data is stored under `project_id: "olympic-hill"`
- **Result:** No RAG context retrieval, app queries wrong project

**Actual Projects in Database:**
- `test-project` ✅ (has 1 document)
- `olympic-hill` ✅ (has 1 document with budget data)
- `downtown-olympic` ⚠️ (exists but has 0 documents)
- `highland-park` ⚠️ (exists but has 0 documents)
- `santa-monica-expansion` ⚠️ (exists but has 0 documents)

---

### Issue #2: ❌ **Data Directory Path Resolution in Packaged App**
**Location:** `backend/services/vectorStore.js:14-15`

**Current Code:**
```javascript
this.vectorStorePath = path.join(process.cwd(), 'data', 'vector_store.json');
this.projectsPath = path.join(process.cwd(), 'data', 'projects.json');
```

**Problem:**
- `process.cwd()` returns different paths in dev vs packaged app
- **Dev mode:** `C:\...\ollama-chatbot-vite\backend\data\`
- **Packaged EXE:** `C:\Users\{user}\AppData\Local\Programs\ollama-chatbot\` (WRONG!)
- Data files are bundled but path resolution fails in production

**Impact:**
- Packaged app cannot find `vector_store.json` or `projects.json`
- RAG system initializes with empty data
- Olympic Hill embeddings are unreachable

---

### Issue #3: ❌ **Backend Server Working Directory**
**Location:** `electron.js:89`

**Current Code:**
```javascript
backendProc = run("backend", process.execPath, [BACKEND_CJS], {
  cwd: path.dirname(BACKEND_CJS), // Sets cwd to backend/ directory
});
```

**Problem:**
- Backend server starts in `backend/` directory
- Relative paths like `./data/` resolve correctly in dev
- In packaged app, `backend/` might be inside `app.asar` (read-only)
- Data directory needs to be in unpacked resources

---

### Issue #4: ⚠️ **RAG Services May Not Be Included in Build**
**Location:** `package.json:48`

**Current Build Config:**
```json
"files": [
  "dist/**/*",
  "electron.js",
  "ollama-bin/**/*",
  "resources/**/*",
  "!dist_electron/**",
  "backend/**/**"  // ⚠️ Double wildcard might cause issues
]
```

**Concerns:**
- `backend/**/**` should be `backend/**/*`
- ES modules (`.js` files with `import/export`) might not execute in packaged app
- `asarUnpack` is set for `backend/**` but data files need proper handling

---

### Issue #5: ⚠️ **Frontend Project Selector Has Wrong Default**
**Location:** `src/components/Chatbot.vue:95`

**Current Code:**
```javascript
selectedProject: 'test-project', // Default to test project for now
```

**Problem:**
- User selects "Downtown Olympic/Hill" but it sends `"downtown-olympic"`
- Even if user doesn't change selection, default is wrong project
- No visual feedback showing if RAG context was retrieved

---

## ✅ SOLUTIONS

### Fix #1: Correct Project ID in Frontend Selector

**File:** `src/components/Chatbot.vue`

**Change line 50 from:**
```vue
<option value="downtown-olympic">Downtown Olympic/Hill</option>
```

**To:**
```vue
<option value="olympic-hill">Downtown Olympic/Hill</option>
```

**Also update default selection (line 95):**
```javascript
selectedProject: 'olympic-hill', // Default to Olympic Hill project
```

---

### Fix #2: Fix Data Directory Path Resolution for Packaged App

**File:** `backend/services/vectorStore.js`

**Replace lines 13-16:**

```javascript
class VectorStore {
  constructor() {
    // FIX: Resolve data directory relative to this file's location, not cwd
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const backendDir = path.resolve(__dirname, '..');

    this.vectorStorePath = path.join(backendDir, 'data', 'vector_store.json');
    this.projectsPath = path.join(backendDir, 'data', 'projects.json');

    console.log('[VectorStore] Data paths:');
    console.log('  Vector store:', this.vectorStorePath);
    console.log('  Projects:', this.projectsPath);

    this.ensureDataFiles();
  }
```

**Alternative for Windows paths (if URLs have issues):**

```javascript
import { fileURLToPath } from 'url';
import { dirname } from 'path';

class VectorStore {
  constructor() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const backendDir = path.resolve(__dirname, '..');

    this.vectorStorePath = path.join(backendDir, 'data', 'vector_store.json');
    this.projectsPath = path.join(backendDir, 'data', 'projects.json');

    this.ensureDataFiles();
  }
```

---

### Fix #3: Apply Same Fix to All RAG Services

**Files that need the same fix:**
1. `backend/utils/logger.js` (if it uses `process.cwd()` for log paths)
2. Any other service that references `data/` directory

**Pattern to find and replace:**
```bash
# Search for problematic patterns:
grep -r "process.cwd()" backend/
grep -r "path.join.*data" backend/
```

---

### Fix #4: Ensure Data Directory in Build

**File:** `package.json`

**Update build configuration:**

```json
"build": {
  "appId": "com.ollama.chatbot",
  "productName": "Ollama Chatbot",
  "directories": {
    "output": "dist_electron"
  },
  "files": [
    "dist/**/*",
    "electron.js",
    "resources/**/*",
    "backend/**/*",        // ✅ Fixed: single wildcard
    "!backend/node_modules/**/*",  // Exclude node_modules
    "!dist_electron/**"
  ],
  "asarUnpack": [
    "backend/**",          // ✅ Unpack entire backend for ES modules
    "resources/**"
  ],
  "extraResources": [
    {
      "from": "resources/ollama.exe",
      "to": "ollama.exe"
    },
    {
      "from": "backend/data",    // ✅ Include data directory in resources
      "to": "backend/data"
    }
  ]
}
```

---

### Fix #5: Add Visual Feedback for RAG Context

**File:** `src/components/Chatbot.vue`

**Add after line 216 (in sendMessage method):**

```javascript
body: JSON.stringify({
    model: this.model,
    message: messageToSend,
    project_id: this.selectedProject || null
}),
```

**Add console logging:**

```javascript
console.log('[Chat] Sending with project_id:', this.selectedProject);
```

**Better yet, add a status indicator in the UI:**

```vue
<!-- Add after project selector (line 55) -->
<div v-if="selectedProject" class="project-status">
  📁 Active Project: {{ getProjectName(selectedProject) }}
</div>
```

```javascript
// In methods:
getProjectName(projectId) {
  const projectNames = {
    'test-project': 'Test Project (Safety Protocol)',
    'olympic-hill': 'Olympic Hill High-Rise',
    'highland-park': 'Highland Park Residential',
    'santa-monica-expansion': 'Santa Monica Expansion'
  };
  return projectNames[projectId] || 'Unknown Project';
}
```

---

## 🔧 Quick Test After Fixes

### 1. Test in Development Mode First

```bash
# Start backend with logging
cd backend
node server-enhanced.cjs
```

**Expected logs:**
```
[VectorStore] Data paths:
  Vector store: C:\...\backend\data\vector_store.json
  Projects: C:\...\backend\data\projects.json
✅ RAG system enabled with security protection
```

### 2. Test Frontend Connection

Open browser console and run:
```javascript
fetch('http://localhost:5000/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'deepseek-r1:1.5b',
    message: 'What is the budget for Olympic Hill?',
    project_id: 'olympic-hill'
  })
}).then(r => console.log('Response:', r.status));
```

**Expected:** Status 200 with streaming response

### 3. Test Packaged App

```bash
npm run electron:build
```

**After installing, check logs:**
- Open app
- Press F12 (if devtools enabled)
- Or check: `%APPDATA%\ollama-chatbot\logs\`

**Expected logs:**
```
[backend] [VectorStore] Data paths:
[backend]   Vector store: C:\Users\...\resources\app.asar.unpacked\backend\data\vector_store.json
[backend] ✅ RAG system enabled
```

---

## 📋 Summary of Changes Needed

### Must Fix (Blocking RAG):
1. ✅ Change `downtown-olympic` → `olympic-hill` in Chatbot.vue:50
2. ✅ Fix data path resolution in vectorStore.js
3. ✅ Fix data path resolution in logger.js (if applicable)
4. ✅ Update package.json build config

### Should Fix (Better UX):
5. ✅ Add console logging for debugging
6. ✅ Add visual feedback for active project
7. ✅ Change default project to `olympic-hill`

### Optional (Nice to Have):
8. Load available projects from API instead of hardcoding
9. Show RAG context stats (chunks retrieved, similarity scores)
10. Add error handling if project not found

---

## 🎯 Root Cause Summary

**Why Olympic Hill data doesn't work in packaged EXE:**

1. **Wrong project ID** → Frontend sends `downtown-olympic` instead of `olympic-hill`
2. **Wrong file paths** → `process.cwd()` resolves to wrong directory in packaged app
3. **Data not accessible** → Backend can't find `vector_store.json` with Olympic Hill embeddings

**After fixes:**
- Frontend sends correct project ID ✅
- Backend finds data files in unpacked resources ✅
- RAG system retrieves Olympic Hill context ✅
- DeepSeek answers with $500M budget ✅
