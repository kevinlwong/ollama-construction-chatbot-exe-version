<template>

  <div>
    <h1>Ollama Multi-Model Chatbot</h1>

    <!--Sidebar-->
    <Sidebar />

    <!--Model Selection-->
    <ModelSelection />

    <!-- Chatbot Component (Pass the Active Model) -->
    <Chatbot :model="selectedModel" />
  </div>


  <!-- <div class="app-container">
    <h1>WeekendAI Construction Chatbot</h1> -->

  <!-- Tab Navigation -->
  <!-- <div class="tabs">
      <button
        v-for="(tab, index) in tabs"
        :key="index"
        :class="{ active: activeTab === tab.name }"
        @click="setActiveTab(tab.name, tab.model)"
      >
        {{ tab.name }}
      </button>
    </div> -->

  <!-- Chatbot Component (Pass the Active Model) -->
  <!-- <Chatbot :model="activeModel" />
  </div> -->
</template>

<script>
import Chatbot from './components/Chatbot.vue';
import Sidebar from "./components/sidebar/Sidebar.vue";
import ModelSelection from "./components/model-selection/ModelSelection.vue";
import { selectedModel } from "./components/model-selection/modelselect-state.js";

export default {
  components: { Chatbot, Sidebar, ModelSelection },

  setup() {
    return { selectedModel };
  },
  // data() {
  //   return {
  //     activeTab: 'Precon', // Default to Precon
  //     activeModel: 'deepseek-r1:7b', // Default model for Precon
  //     tabs: [
  //       { name: 'Precon', model: 'deepseek-r1:7b' },
  //       { name: 'Con', model: 'qwen2.5:7b' },
  //       { name: 'Postcon', model: 'deepseek-r1:7b' }
  //     ]
  //   };
  // },
  // methods: {
  //   setActiveTab(tabName, model) {
  //     this.activeTab = tabName;
  //     this.activeModel = model;
  //   }
  // }
};
</script>

<style>
html,
body {
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #ffffff;
  display: flex;
  justify-content: center;
  align-items: center;
}

.tabs {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 20px;
}

.tabs button {
  padding: 10px 20px;
  border: none;
  background: #333;
  color: white;
  font-size: 16px;
  cursor: pointer;
  border-radius: 5px;
}

.tabs button.active {
  background: #007bff;
  font-weight: bold;
}

@font-face {
  font-family: 'Inter';
  src: url('@/assets/fonts/inter.woff2') format('woff2');
  /* Path relative to CSS file */
}

@font-face {
  font-family: 'Roboto';
  src: url('@/assets/fonts/roboto.woff2') format('woff2');
}
</style>
