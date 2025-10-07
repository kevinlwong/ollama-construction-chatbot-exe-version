/**
 * Script to process Olympic Hill project data into RAG system
 */

import fs from 'fs/promises';
import path from 'path';
import ragService from './services/ragService.js';
import vectorStore from './services/vectorStore.js';

async function processOlympicHill() {
  console.log('🏗️  Processing Olympic Hill Project Data...\n');

  try {
    // Step 1: Create the Olympic Hill project
    console.log('1. Creating Olympic Hill project...');
    const projectData = {
      id: 'olympic-hill',
      name: 'Olympic Hill High-Rise Construction Project',
      description: 'Downtown LA high-rise construction project by Onni Construction. $500M budget, 30-month timeline, 7-level underground parking.',
      tags: ['downtown-la', 'high-rise', 'onni-construction', 'residential', 'concrete'],
      metadata: {
        location: 'Downtown Los Angeles',
        general_contractor: 'Onni Construction',
        budget: '$500M',
        timeline: '30 months',
        concrete_budget: '$80M',
        parking_levels: 7
      }
    };

    try {
      const project = await vectorStore.addProject(projectData);
      console.log('✅ Project created:', project.id);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('✅ Project already exists, continuing...');
      } else {
        throw error;
      }
    }

    // Step 2: Read the Olympic Hill document
    console.log('\n2. Reading Olympic Hill project document...');
    const documentPath = path.join(process.cwd(), 'data', 'olympic-hill-project.txt');
    const documentText = await fs.readFile(documentPath, 'utf8');
    console.log(`✅ Document loaded: ${documentText.length} characters`);

    // Step 3: Process the document through RAG system
    console.log('\n3. Processing document and generating embeddings...');
    console.log('   This may take a few minutes as embeddings are generated...');

    const result = await ragService.processDocument(
      documentText,
      'olympic-hill',
      {
        filename: 'olympic-hill-project.txt',
        file_type: '.txt',
        file_size: documentText.length,
        upload_date: new Date().toISOString(),
        document_type: 'project_specifications',
        source: 'project_documentation'
      },
      {
        chunkSize: 600,  // Slightly larger chunks for technical content
        overlap: 75,      // More overlap to preserve context
        smartChunking: true
      }
    );

    console.log('\n✅ Document processed successfully!');
    console.log('\nProcessing Statistics:');
    console.log(`   📄 Total chunks created: ${result.stats.chunkCount}`);
    console.log(`   📏 Average chunk size: ${Math.round(result.stats.averageChunkSize)} characters`);
    console.log(`   ⏱️  Processing time: ${result.stats.processingTime}ms`);
    console.log(`   🔢 Total characters: ${result.stats.totalCharacters}`);

    // Step 4: Verify the embeddings were stored
    console.log('\n4. Verifying embeddings storage...');
    const stats = await ragService.getSystemStats();

    console.log('\n✅ Embeddings verified!');
    console.log('\nSystem Statistics:');
    console.log(`   🏢 Total projects: ${stats.vector_store.total_projects}`);
    console.log(`   📦 Total chunks stored: ${stats.vector_store.total_chunks}`);
    console.log(`   💾 Embedding cache size: ${stats.embedding_cache.size}`);

    // Step 5: Test retrieval with sample queries
    console.log('\n5. Testing retrieval with sample queries...\n');

    const testQueries = [
      'What is the total budget for Olympic Hill?',
      'Tell me about the concrete pour sequence',
      'What are the site challenges?',
      'What is the rebar schedule for the tower?',
      'How many workers are needed for the tower crew?'
    ];

    for (const query of testQueries) {
      console.log(`\n📝 Query: "${query}"`);

      const retrievalResult = await ragService.retrieveContext(query, {
        projectId: 'olympic-hill',
        limit: 3,
        threshold: 0.1
      });

      if (retrievalResult.chunks.length > 0) {
        console.log(`   ✅ Found ${retrievalResult.chunks.length} relevant chunks`);
        console.log(`   📊 Best similarity score: ${retrievalResult.chunks[0].similarity.toFixed(3)}`);
        console.log(`   📄 Context preview: ${retrievalResult.context.substring(0, 150).replace(/\n/g, ' ')}...`);
      } else {
        console.log(`   ⚠️  No relevant chunks found`);
      }
    }

    console.log('\n\n🎉 Olympic Hill project data successfully embedded!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Start the server: npm run start:enhanced');
    console.log('   2. Query the chatbot with Olympic Hill questions');
    console.log('   3. Include project_id: "olympic-hill" in your chat requests');
    console.log('\nExample chat request:');
    console.log(`   POST /chat`);
    console.log(`   {`);
    console.log(`     "model": "llama3.2",`);
    console.log(`     "message": "What are the main challenges for Olympic Hill?",`);
    console.log(`     "project_id": "olympic-hill"`);
    console.log(`   }`);

  } catch (error) {
    console.error('\n❌ Error processing Olympic Hill project:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the processing
processOlympicHill().then(() => {
  console.log('\n✅ Script completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
