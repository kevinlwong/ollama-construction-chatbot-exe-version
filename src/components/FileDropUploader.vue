<template>
  <div class="file-drop" @dragover.prevent @drop.prevent="onDrop" @click="triggerFileSelect">
    <input ref="inputRef" type="file" class="visually-hidden" @change="onFileChange" />
    <div v-if="fileName" class="file-name">
      <i class="fa-solid fa-file"></i> {{ fileName }}
    </div>
    <div v-else class="drop-instruction">
      Drag & drop file or click to upload
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const inputRef = ref(null);
const emit = defineEmits(['file-selected']);
const fileName = ref('');

function triggerFileSelect() {
  inputRef.value.click();
}

function onFileChange(e) {
  const file = e.target.files[0];
  console.log("File:", file)           // inspect in DevTools
  console.log("File name:", file.name)      // standard API
  console.log("File path:", file.path)
  if (file) {
    fileName.value = file.name;
    emit('file-selected', file);
  }
}

function onDrop(e) {
  const file = e.dataTransfer.files[0];
  console.log("File:", file)           // inspect in DevTools
  console.log("File name:", file.name)      // standard API
  console.log("File path:", file.path)
  if (file) {
    fileName.value = file.name;
    emit('file-selected', file);
  }
}
</script>

<style scoped>
.file-drop {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 14px;
  text-align: center;
  color: #555;
  cursor: pointer;
  margin-bottom: 1rem;
  transition: 0.2s ease-in-out;
}

.file-drop:hover {
  background: #f9f9f9;
}

.file-name {
  color: #2d85f0;
  font-weight: 600;
}

.drop-instruction {
  font-size: 14px;
  color: #888;
}

/* Hide the native file input completely */
.visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
</style>
