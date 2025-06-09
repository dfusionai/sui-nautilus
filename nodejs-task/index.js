#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const https = require('https')

console.log('🚀 Node.js task starting...')

// Simple task 1: Create a temporary file with current timestamp
function createTimestampFile() {
  const timestamp = new Date().toISOString()
  const filePath = path.join(__dirname, 'task-output.txt')
  
  const content = `Task executed at: ${timestamp}\nPID: ${process.pid}\nNode version: ${process.version}\n`
  
  fs.writeFileSync(filePath, content)
  console.log(`✅ Created file: ${filePath}`)
}

// Simple task 2: Fetch data from a public API
function fetchApiData() {
  return new Promise((resolve, reject) => {
    const url = 'https://api.github.com/zen'
    
    https.get(url, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        console.log(`✅ API Response: ${data.trim()}`)
        resolve(data)
      })
    }).on('error', (err) => {
      console.error(`❌ API Error: ${err.message}`)
      reject(err)
    })
  })
}

// Simple task 3: Process some data
function processData() {
  const numbers = Array.from({length: 10}, (_, i) => i + 1)
  const sum = numbers.reduce((acc, num) => acc + num, 0)
  const average = sum / numbers.length
  
  console.log(`✅ Processed data: sum=${sum}, average=${average}`)
  return { sum, average }
}

// Main function to run all tasks
async function runTasks() {
  try {
    console.log('📝 Running Task 1: Creating timestamp file...')
    createTimestampFile()
    
    console.log('🌐 Running Task 2: Fetching API data...')
    await fetchApiData()
    
    console.log('🔢 Running Task 3: Processing data...')
    processData()
    
    console.log('🎉 All tasks completed successfully!')
    process.exit(0)
  } catch (error) {
    console.error('💥 Task failed:', error.message)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...')
  process.exit(0)
})

// Run the tasks
runTasks() 