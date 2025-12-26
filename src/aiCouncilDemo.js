/**
 * AI Council Service - Demo / Usage Example
 * 
 * This file demonstrates how to use the AICouncilService in your Electron app.
 * Run this directly with Node.js to test the council workflow.
 * 
 * Usage: node src/aiCouncilDemo.js
 */

const { AICouncilService, setSearchFunction } = require('./aiCouncilService');

// ============================================================================
// DEMO SETUP
// ============================================================================

/**
 * Create an instance of the AI Council Service with debug logging
 * and progress callbacks
 */
const council = new AICouncilService({
    debug: true,  // Enable verbose logging
    
    // Optional: Override models
    // chairmanModel: 'qwen3:14b',
    // memberModel: 'qwen3:8b',
    
    // Progress callbacks for UI updates
    onPhaseStart: ({ phase, name, taskCount }) => {
        console.log(`\n🚀 PHASE ${phase} STARTING: ${name}${taskCount ? ` (${taskCount} tasks)` : ''}`);
    },
    
    onPhaseComplete: ({ phase, result, results }) => {
        console.log(`✅ PHASE ${phase} COMPLETE`);
    },
    
    onTaskStart: ({ taskIndex, role }) => {
        console.log(`   📋 Task ${taskIndex + 1} started: ${role}`);
    },
    
    onTaskComplete: ({ taskIndex, role, success, error }) => {
        const icon = success ? '✓' : '✗';
        console.log(`   ${icon} Task ${taskIndex + 1} completed: ${role}`);
        if (error) console.log(`      Error: ${error}`);
    },
    
    onToolCall: ({ taskIndex, toolName, args }) => {
        console.log(`   🔧 Task ${taskIndex + 1} calling tool: ${toolName}`);
    }
});

// ============================================================================
// EXAMPLE QUERIES
// ============================================================================

const exampleQueries = [
    "What are the key differences between React and Vue.js, and which should I choose for a new enterprise project?",
    "Explain the current state of AI regulation globally and its impact on tech companies.",
    "How can I improve the performance of a Node.js application handling 10,000 concurrent connections?",
    "What are the best practices for securing an Electron application?"
];

// ============================================================================
// MAIN DEMO FUNCTION
// ============================================================================

async function runDemo() {
    console.log('═'.repeat(70));
    console.log('         AI COUNCIL SERVICE - DEMONSTRATION');
    console.log('═'.repeat(70));
    
    // First, run a health check
    console.log('\n📡 Running health check...');
    const health = await council.healthCheck();
    
    if (!health.healthy) {
        console.error('❌ Health check failed:', health.error);
        console.log('\nPlease ensure Ollama is running: ollama serve');
        process.exit(1);
    }
    
    console.log('✅ Ollama connected');
    console.log('📦 Available models:', health.availableModels.join(', '));
    console.log('👑 Chairman model:', health.requiredModels.chairman.model, 
        health.requiredModels.chairman.available ? '✓' : '✗ NOT FOUND');
    console.log('👥 Member model:', health.requiredModels.member.model,
        health.requiredModels.member.available ? '✓' : '✗ NOT FOUND');
    
    if (!health.requiredModels.chairman.available || !health.requiredModels.member.available) {
        console.log('\n⚠️  Warning: Some required models may not be available.');
        console.log('Run: ollama pull qwen3:14b && ollama pull qwen3:8b');
    }
    
    // Run the demo with the first example query
    const query = exampleQueries[0];
    
    console.log('\n' + '─'.repeat(70));
    console.log('📝 QUERY:', query);
    console.log('─'.repeat(70));
    
    const result = await council.processQuery(query);
    
    // Display results
    console.log('\n' + '═'.repeat(70));
    console.log('                         RESULTS');
    console.log('═'.repeat(70));
    
    if (result.success) {
        console.log('\n📊 EXECUTION SUMMARY:');
        console.log(`   • Duration: ${result.metadata.duration}ms`);
        console.log(`   • Tasks: ${result.metadata.successfulTasks}/${result.metadata.taskCount} successful`);
        console.log(`   • Chairman: ${result.metadata.chairmanModel}`);
        console.log(`   • Members: ${result.metadata.memberModel}`);
        
        console.log('\n📋 EXECUTION PLAN:');
        result.plan.forEach((task, i) => {
            console.log(`   ${i + 1}. [${task.role}] ${task.task_description}`);
            console.log(`      Needs search: ${task.needs_search}`);
        });
        
        console.log('\n👥 COUNCIL REPORTS:');
        result.councilResults.forEach((report, i) => {
            console.log(`\n   ─── ${report.role} ───`);
            console.log(`   ${report.response.substring(0, 300)}...`);
        });
        
        console.log('\n' + '═'.repeat(70));
        console.log('                    FINAL SYNTHESIZED ANSWER');
        console.log('═'.repeat(70));
        console.log(result.finalResponse);
        
    } else {
        console.error('\n❌ Query processing failed:', result.error);
    }
    
    console.log('\n' + '═'.repeat(70));
    console.log('                    DEMO COMPLETE');
    console.log('═'.repeat(70));
}

// ============================================================================
// INTEGRATION EXAMPLE - For use in Electron Main Process
// ============================================================================

/**
 * Example of how to integrate with Electron IPC
 * This is already implemented in main.js - use the following API from renderer:
 */
const rendererUsageExample = `
// In renderer.js - Using the AI Council from the UI:

// 1. Check service health
const health = await window.electronAPI.councilHealthCheck();
if (!health.healthy) {
    console.error('Council not ready:', health.error);
    return;
}

// 2. Set up progress listeners (optional)
window.electronAPI.onCouncilPhaseStart((data) => {
    console.log('Phase started:', data.phase, data.name);
    updateUI({ phase: data.phase, status: 'running' });
});

window.electronAPI.onCouncilTaskStart((data) => {
    console.log('Task started:', data.role);
    addTaskToUI(data);
});

window.electronAPI.onCouncilTaskComplete((data) => {
    console.log('Task completed:', data.role, data.success ? '✓' : '✗');
    updateTaskInUI(data);
});

window.electronAPI.onCouncilToolCall((data) => {
    console.log('Tool called:', data.toolName, data.args);
});

// 3. Process a query
const result = await window.electronAPI.councilProcess(
    "What are the best practices for building scalable Node.js applications?",
    { 
        // Optional: override models
        // chairmanModel: 'qwen3:14b',
        // memberModel: 'qwen3:8b'
    }
);

if (result.success) {
    console.log('Plan:', result.plan);
    console.log('Council Reports:', result.councilResults);
    console.log('Final Answer:', result.finalResponse);
    console.log('Duration:', result.metadata.duration, 'ms');
} else {
    console.error('Failed:', result.error);
}

// 4. Clean up listeners when done
window.electronAPI.removeCouncilListeners();
`;

console.log('\n📖 Renderer Usage Example:');
console.log(rendererUsageExample);

// ============================================================================
// RUN DEMO
// ============================================================================

// Run if executed directly
if (require.main === module) {
    runDemo().catch(console.error);
}

module.exports = { runDemo, council };
