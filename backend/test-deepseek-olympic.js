/**
 * Test DeepSeek with Olympic Hill RAG context
 */

import ragService from './services/ragService.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const OLLAMA_PATH = path.resolve(process.cwd(), "..", "resources", "ollama.exe");

async function testDeepSeekWithRAG() {
  console.log('🧪 Testing DeepSeek with Olympic Hill RAG context...\n');

  try {
    // Step 1: Get RAG context
    const query = 'What is the budget for Olympic Hill?';
    console.log('📝 User Query:', query);
    console.log('');

    console.log('🔍 Retrieving relevant context from vector store...');
    const ragResult = await ragService.retrieveContext(query, {
      projectId: 'olympic-hill',
      limit: 5,
      threshold: 0.1
    });

    console.log(`✅ Found ${ragResult.chunks.length} relevant chunks`);
    console.log(`📊 Best similarity: ${ragResult.chunks[0].similarity.toFixed(3)}`);
    console.log('');

    // Step 2: Build prompt with RAG context
    const finalPrompt = `${query}

---
Relevant context from project documents:
${ragResult.context}
---`;

    console.log('📤 Sending to DeepSeek with RAG context...');
    console.log('');

    // Step 3: Call DeepSeek
    const ollama = spawn(OLLAMA_PATH, ['run', 'deepseek-r1:1.5b'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    ollama.stdin.write(finalPrompt + '\n');
    ollama.stdin.end();

    let response = '';
    let thinking = '';
    let isThinking = false;

    ollama.stdout.on('data', (chunk) => {
      const text = chunk.toString();

      if (text.includes('<think>')) {
        isThinking = true;
      }

      if (isThinking) {
        thinking += text;
      }

      if (text.includes('</think>')) {
        isThinking = false;
      }

      response += text;
    });

    ollama.stderr.on('data', (data) => {
      const txt = data.toString();
      // Ignore spinner characters
      if (!/^[\u2800-\u28FF]+$/.test(txt.trim())) {
        process.stderr.write(txt);
      }
    });

    await new Promise((resolve) => {
      ollama.on('close', () => {
        resolve();
      });
    });

    // Step 4: Display results
    console.log('🤖 DeepSeek Response:');
    console.log('='.repeat(80));

    // Extract thinking if present
    const thinkMatch = response.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      console.log('\n💭 Thinking Process:');
      console.log(thinkMatch[1].trim());
      console.log('');
    }

    // Extract final answer
    const finalAnswer = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    console.log('\n✅ Final Answer:');
    console.log(finalAnswer);
    console.log('='.repeat(80));

    // Step 5: Verify answer contains budget info
    console.log('\n✅ Verification:');
    const hasBudget = finalAnswer.toLowerCase().includes('500') ||
                      finalAnswer.toLowerCase().includes('million') ||
                      finalAnswer.toLowerCase().includes('$500');

    if (hasBudget) {
      console.log('   ✅ Answer contains budget information from RAG context!');
    } else {
      console.log('   ⚠️  Answer may not have used RAG context properly');
    }

    const hasConcrete = finalAnswer.toLowerCase().includes('80') ||
                        finalAnswer.toLowerCase().includes('concrete');
    if (hasConcrete) {
      console.log('   ✅ Answer includes concrete budget details!');
    }

    console.log('\n📊 RAG Statistics:');
    console.log(`   Chunks retrieved: ${ragResult.chunks.length}`);
    console.log(`   Context length: ${ragResult.context.length} characters`);
    console.log(`   Average similarity: ${ragResult.stats.averageSimilarity.toFixed(3)}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run test
testDeepSeekWithRAG().then(() => {
  console.log('\n✅ Test completed!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
