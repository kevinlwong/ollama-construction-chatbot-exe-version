// src/router/index.js
import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '../views/Home.vue' // Example component

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  // Add more routes as needed
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router