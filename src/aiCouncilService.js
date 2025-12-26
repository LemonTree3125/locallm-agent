/**
 * AICouncilService - Dynamic AI Council Backend Service
 * 
 * Implements a "Manager-Worker" workflow using local Ollama models:
 * - Chairman (qwen3:14b): Strategic planning and final synthesis
 * - Council Members (qwen3:8b): Task execution with tool support
 * 
 * @author AI Council Framework
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const OLLAMA_BASE_URL = 'http://localhost:11434';
const CHAIRMAN_MODEL = 'qwen3:14b';
const MEMBER_MODEL = 'qwen3:8b';

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

/**
 * Web Search Tool Definition (JSON Schema for Function Calling)
 * This schema is passed to models so they can decide to search the web if needed.
 * Named 'searchWeb' to match the existing tool in main.js
 */
const WEB_SEARCH_TOOL = {
    type: 'function',
    function: {
        name: 'searchWeb',
        description: 'Search the web for current information, news, facts, or any topic that requires up-to-date knowledge. Use this when the query requires information beyond your training data or when current/real-time information is needed.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to look up on the web. Be specific and include relevant keywords.'
                }
            },
            required: ['query']
        }
    }
};

/**
 * Array of all available tools for council members
 */
const AVAILABLE_TOOLS = [WEB_SEARCH_TOOL];

// ============================================================================
// SEARCH IMPLEMENTATION
// ============================================================================

// Placeholder for external search function injection
let externalSearchFunction = null;

/**
 * Set the external search function (e.g., Tavily from main.js)
 * @param {Function} searchFn - The search function to use
 */
function setSearchFunction(searchFn) {
    externalSearchFunction = searchFn;
}

/**
 * Fallback mock web search function implementation
 * Used when no external search function is provided
 * 
 * @param {string} query - The search query
 * @returns {Promise<string>} - Mock search results
 */
async function mockWebSearch(query) {
    console.log(`[WebSearch-Mock] Executing mock search for: "${query}"`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Return mock search results
    return `Search results for "${query}":\n\n` +
        `[1] Title: Information about ${query}\n` +
        `Content: This is mock search data. In production, this uses Tavily API for real results.\n` +
        `URL: https://example.com/result1\n\n` +
        `[2] Title: Latest on ${query}\n` +
        `Content: Additional mock content related to the search query.\n` +
        `URL: https://example.com/result2\n`;
}

/**
 * Execute web search using external function or mock
 * 
 * @param {string} query - The search query
 * @returns {Promise<string>} - Search results
 */
async function executeWebSearch(query) {
    console.log(`[AICouncil-WebSearch] Executing search for: "${query}"`);
    
    if (externalSearchFunction) {
        try {
            return await externalSearchFunction(query);
        } catch (error) {
            console.error('[AICouncil-WebSearch] External search failed:', error.message);
            return `Search failed: ${error.message}`;
        }
    }
    
    return await mockWebSearch(query);
}

/**
 * Tool execution dispatcher
 * Routes tool calls to their respective implementations
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} args - Arguments for the tool
 * @returns {Promise<string>} - Tool execution result
 */
async function executeTool(toolName, args) {
    switch (toolName) {
        case 'searchWeb':
        case 'web_search':
            return await executeWebSearch(args.query);
        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}

// ============================================================================
// OLLAMA API CLIENT
// ============================================================================

// Track the currently loaded model to avoid unnecessary unloads
let currentlyLoadedModel = null;

/**
 * Extract thinking content from a response (Qwen3 <think> tags)
 * @param {string} content - Raw response content
 * @returns {object} - { thinking: string|null, output: string }
 */
function extractThinking(content) {
    if (!content) return { thinking: null, output: '' };
    
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
    
    if (thinkMatch) {
        const thinking = thinkMatch[1].trim();
        const output = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        return { thinking, output };
    }
    
    return { thinking: null, output: content };
}

/**
 * Unload a specific model from VRAM
 * 
 * @param {string} modelName - Name of the model to unload
 * @returns {Promise<boolean>} - True if successful
 */
async function unloadModel(modelName) {
    if (!modelName) return true;
    
    console.log(`[AICouncil] Unloading model: ${modelName}`);
    
    try {
        // Send a request with keep_alive=0 to immediately unload
        const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                prompt: '',
                keep_alive: 0
            })
        });
        
        if (response.ok) {
            console.log(`[AICouncil] Model ${modelName} unloaded from VRAM`);
            if (currentlyLoadedModel === modelName) {
                currentlyLoadedModel = null;
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error(`[AICouncil] Failed to unload model ${modelName}:`, error.message);
        return false;
    }
}

/**
 * Ensure only the specified model is loaded in VRAM
 * Unloads any other model before proceeding
 * 
 * @param {string} targetModel - The model we want to use
 * @returns {Promise<void>}
 */
async function ensureSingleModelLoaded(targetModel) {
    if (currentlyLoadedModel && currentlyLoadedModel !== targetModel) {
        console.log(`[AICouncil] Switching from ${currentlyLoadedModel} to ${targetModel}`);
        await unloadModel(currentlyLoadedModel);
    }
    currentlyLoadedModel = targetModel;
}

/**
 * Make a chat completion request to Ollama API
 * 
 * @param {object} options - Request options
 * @param {string} options.model - Model name to use
 * @param {array} options.messages - Chat messages array
 * @param {array} [options.tools] - Optional tool definitions
 * @param {string} [options.format] - Response format ('json' for JSON mode)
 * @param {object} [options.options] - Additional model options
 * @returns {Promise<object>} - API response
 */
async function ollamaChat({ model, messages, tools = null, format = null, options = {} }) {
    const requestBody = {
        model,
        messages,
        stream: false,
        options: {
            temperature: 0.7,
            ...options
        }
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
        requestBody.tools = tools;
    }

    // Add format for JSON mode
    if (format) {
        requestBody.format = format;
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    return await response.json();
}

// ============================================================================
// AI COUNCIL SERVICE CLASS
// ============================================================================

/**
 * AICouncilService - Orchestrates the Dynamic AI Council workflow
 * 
 * Workflow:
 * 1. Chairman analyzes query and creates execution plan
 * 2. Council members execute tasks in parallel with tool support
 * 3. Chairman synthesizes all reports into final answer
 */
class AICouncilService {
    constructor(options = {}) {
        this.chairmanModel = options.chairmanModel || CHAIRMAN_MODEL;
        this.memberModel = options.memberModel || MEMBER_MODEL;
        this.baseUrl = options.baseUrl || OLLAMA_BASE_URL;
        this.debug = options.debug || false;
        
        // Event callbacks for progress tracking
        this.onPhaseStart = options.onPhaseStart || (() => {});
        this.onPhaseComplete = options.onPhaseComplete || (() => {});
        this.onTaskStart = options.onTaskStart || (() => {});
        this.onTaskComplete = options.onTaskComplete || (() => {});
        this.onToolCall = options.onToolCall || (() => {});
    }

    /**
     * Log debug messages if debug mode is enabled
     * @param  {...any} args - Arguments to log
     */
    log(...args) {
        if (this.debug) {
            console.log('[AICouncil]', ...args);
        }
    }

    /**
     * PHASE 1: Chairman's Strategic Planning
     * 
     * The Chairman (qwen3:14b) analyzes the user query and breaks it down
     * into distinct sub-tasks with assigned personas/roles.
     * 
     * @param {string} userPrompt - The original user query
     * @returns {Promise<array>} - Array of task assignments
     */
    async executePhase1_ChairmanPlan(userPrompt) {
        this.log('Phase 1: Chairman analyzing query and creating plan...');
        this.onPhaseStart({ phase: 1, name: 'Chairman Planning' });

        // Ensure chairman model is the only one loaded
        await ensureSingleModelLoaded(this.chairmanModel);

        // Note: Ollama's JSON mode (format: 'json') typically returns an object, not an array
        // So we ask for { "tasks": [...] } format
        const systemPrompt = `You are the Chairman of an AI Council. Analyze the user query and create a strategic execution plan.

CRITICAL: Your response must be ONLY valid JSON with this exact structure:
{
  "tasks": [
    {"role": "Expert Role", "task_description": "What this expert should do", "needs_search": false},
    {"role": "Another Expert", "task_description": "What they should do", "needs_search": true}
  ]
}

Guidelines:
- Create 2-4 sub-tasks to address the user's query
- "role": A descriptive expert persona (e.g., "Research Analyst", "Technical Expert", "Code Reviewer")
- "task_description": Clear, specific instructions for that expert
- "needs_search": Set to true only if the task requires current/external information

Output ONLY the JSON object. No explanations, no markdown code blocks, no other text.`;

        try {
            const response = await ollamaChat({
                model: this.chairmanModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                format: 'json',
                options: { temperature: 0.3 } // Lower temperature for more structured output
            });

            const content = response.message?.content;
            if (!content) {
                throw new Error('Empty response from Chairman model');
            }

            // Extract thinking from response
            const { thinking, output } = extractThinking(content);
            
            // Parse and validate JSON response
            const plan = this.parseChairmanPlan(content);
            
            this.log('Phase 1 Complete. Plan:', JSON.stringify(plan, null, 2));
            this.onPhaseComplete({ 
                phase: 1, 
                result: plan,
                rawOutput: output,
                thinking: thinking
            });
            
            // Store raw data for final result
            this._phase1Data = { rawOutput: output, thinking };
            
            return plan;

        } catch (error) {
            this.log('Phase 1 Error:', error.message);
            throw new Error(`Chairman planning failed: ${error.message}`);
        }
    }

    /**
     * Parse and validate the Chairman's JSON plan
     * 
     * @param {string} content - Raw JSON string from model
     * @returns {array} - Validated plan array
     */
    parseChairmanPlan(content) {
        let plan;
        
        // Always log to console for debugging
        console.log('[AICouncil] Raw Chairman response (first 800 chars):', content.substring(0, 800));
        
        // Strip out <think>...</think> blocks that Qwen3 might include
        let cleanedContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        
        // Also strip markdown code blocks if present
        cleanedContent = cleanedContent.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        
        console.log('[AICouncil] Cleaned content (first 800 chars):', cleanedContent.substring(0, 800));
        
        try {
            // Try to parse the JSON directly
            plan = JSON.parse(cleanedContent);
            console.log('[AICouncil] Direct JSON parse succeeded');
        } catch (parseError) {
            console.log('[AICouncil] Direct JSON parse failed:', parseError.message);
            
            // Attempt to extract JSON from the response if wrapped in text/markdown
            // Use greedy match for the complete array - find outermost brackets
            let jsonMatch = null;
            
            // First try to find a complete array by finding balanced brackets
            const arrayStart = cleanedContent.indexOf('[');
            if (arrayStart !== -1) {
                let depth = 0;
                let arrayEnd = -1;
                for (let i = arrayStart; i < cleanedContent.length; i++) {
                    if (cleanedContent[i] === '[') depth++;
                    else if (cleanedContent[i] === ']') depth--;
                    if (depth === 0) {
                        arrayEnd = i;
                        break;
                    }
                }
                if (arrayEnd !== -1) {
                    jsonMatch = cleanedContent.substring(arrayStart, arrayEnd + 1);
                    console.log('[AICouncil] Found array via bracket matching:', jsonMatch.substring(0, 300));
                }
            }
            
            // If no array, try to find an object (model might wrap in { "tasks": [...] })
            if (!jsonMatch) {
                const objStart = cleanedContent.indexOf('{');
                if (objStart !== -1) {
                    let depth = 0;
                    let objEnd = -1;
                    for (let i = objStart; i < cleanedContent.length; i++) {
                        if (cleanedContent[i] === '{') depth++;
                        else if (cleanedContent[i] === '}') depth--;
                        if (depth === 0) {
                            objEnd = i;
                            break;
                        }
                    }
                    if (objEnd !== -1) {
                        jsonMatch = cleanedContent.substring(objStart, objEnd + 1);
                        console.log('[AICouncil] Found object via bracket matching:', jsonMatch.substring(0, 300));
                    }
                }
            }
            
            if (jsonMatch) {
                try {
                    plan = JSON.parse(jsonMatch);
                    console.log('[AICouncil] Extracted JSON parse succeeded');
                } catch (innerError) {
                    console.log('[AICouncil] Extracted JSON parse failed:', innerError.message);
                    throw new Error(`Failed to parse Chairman's plan as JSON: ${parseError.message}`);
                }
            } else {
                throw new Error(`Chairman's response is not valid JSON: ${cleanedContent.substring(0, 200)}...`);
            }
        }

        console.log('[AICouncil] Parsed plan type:', typeof plan, 'isArray:', Array.isArray(plan));
        
        // Handle case where model returns { "tasks": [...] } or { "plan": [...] } wrapper
        if (plan && typeof plan === 'object' && !Array.isArray(plan)) {
            console.log('[AICouncil] Plan is object, looking for array keys. Keys:', Object.keys(plan));
            // Look for common wrapper keys
            const possibleArrayKeys = ['tasks', 'plan', 'subtasks', 'sub_tasks', 'items', 'assignments'];
            for (const key of possibleArrayKeys) {
                if (Array.isArray(plan[key])) {
                    console.log(`[AICouncil] Found plan array under key '${key}'`);
                    plan = plan[key];
                    break;
                }
            }
            
            // If still an object, check if it has numeric keys (0, 1, 2...) - array-like object
            if (!Array.isArray(plan) && typeof plan === 'object') {
                const values = Object.values(plan);
                if (values.length > 0 && values.every(v => typeof v === 'object' && v !== null)) {
                    console.log('[AICouncil] Converting object values to array');
                    plan = values;
                }
            }
        }

        // Validate the plan structure
        if (!Array.isArray(plan)) {
            console.log('[AICouncil] Plan is not an array. Type:', typeof plan, 'Value:', JSON.stringify(plan).substring(0, 300));
            throw new Error('Chairman\'s plan must be an array of tasks');
        }
        
        console.log('[AICouncil] Plan validated as array with', plan.length, 'tasks');

        if (plan.length < 1 || plan.length > 6) {
            this.log(`Warning: Plan has ${plan.length} tasks (expected 2-4)`);
        }

        // Validate and normalize each task object
        plan.forEach((task, index) => {
            // Handle alternative field names
            if (!task.role && task.persona) task.role = task.persona;
            if (!task.role && task.expert) task.role = task.expert;
            if (!task.role && task.agent) task.role = task.agent;
            
            if (!task.task_description && task.description) task.task_description = task.description;
            if (!task.task_description && task.task) task.task_description = task.task;
            if (!task.task_description && task.instruction) task.task_description = task.instruction;
            
            if (typeof task.role !== 'string' || !task.role.trim()) {
                throw new Error(`Task ${index + 1} missing valid 'role' field`);
            }
            if (typeof task.task_description !== 'string' || !task.task_description.trim()) {
                throw new Error(`Task ${index + 1} missing valid 'task_description' field`);
            }
            // Default needs_search to false if not specified
            if (typeof task.needs_search !== 'boolean') {
                task.needs_search = !!task.needs_search || !!task.search || !!task.web_search || false;
            }
        });

        return plan;
    }

    /**
     * PHASE 2: Council Member Execution
     * 
     * Execute all tasks SEQUENTIALLY using council members (qwen3:8b).
     * Only one prompt runs at a time to ensure single-model VRAM usage.
     * Each member adopts their assigned persona and may use tools.
     * 
     * @param {string} originalPrompt - The original user query for context
     * @param {array} plan - The task plan from Phase 1
     * @returns {Promise<array>} - Array of task results
     */
    async executePhase2_CouncilExecution(originalPrompt, plan) {
        this.log(`Phase 2: Executing ${plan.length} tasks sequentially (single-model VRAM mode)...`);
        this.onPhaseStart({ phase: 2, name: 'Council Execution', taskCount: plan.length });

        // Unload chairman model before loading member model
        await unloadModel(this.chairmanModel);
        
        // Ensure member model is the only one loaded
        await ensureSingleModelLoaded(this.memberModel);

        // Execute tasks SEQUENTIALLY - one at a time
        const results = [];
        
        try {
            for (let index = 0; index < plan.length; index++) {
                const task = plan[index];
                this.log(`Task ${index + 1}/${plan.length}: Starting...`);
                
                const result = await this.executeCouncilMemberTask(originalPrompt, task, index);
                results.push(result);
                
                this.log(`Task ${index + 1}/${plan.length}: Complete`);
            }
            
            this.log('Phase 2 Complete. All tasks finished.');
            this.onPhaseComplete({ phase: 2, results });
            
            return results;

        } catch (error) {
            this.log('Phase 2 Error:', error.message);
            throw new Error(`Council execution failed: ${error.message}`);
        }
    }

    /**
     * Execute a single council member's task with tool support
     * 
     * @param {string} originalPrompt - Original user query
     * @param {object} task - Task assignment from the plan
     * @param {number} taskIndex - Task index for logging
     * @returns {Promise<object>} - Task result with role and response
     */
    async executeCouncilMemberTask(originalPrompt, task, taskIndex) {
        const { role, task_description, needs_search } = task;
        
        this.log(`Task ${taskIndex + 1}: ${role} starting...`);
        this.onTaskStart({ taskIndex, role, task_description });

        const systemPrompt = `You are ${role}, a member of an expert AI Council.

YOUR ROLE: ${role}
YOUR SPECIFIC TASK: ${task_description}

CONTEXT: The user's original query was: "${originalPrompt}"

INSTRUCTIONS:
1. Focus exclusively on your assigned task
2. Provide thorough, expert-level analysis
3. If you need current information and have access to web_search, use it
4. Be concise but comprehensive
5. Format your response clearly

Provide your expert contribution to help answer the user's query.`;

        // Prepare messages for the conversation
        let messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Please complete your assigned task: ${task_description}` }
        ];

        // Determine if we should provide tools
        const tools = needs_search ? AVAILABLE_TOOLS : null;
        
        try {
            // Execute with tool loop support
            const rawResponse = await this.executeWithToolLoop(messages, tools, taskIndex);
            
            // Extract thinking from response
            const { thinking, output } = extractThinking(rawResponse);
            
            this.log(`Task ${taskIndex + 1}: ${role} completed.`);
            this.onTaskComplete({ 
                taskIndex, 
                role, 
                success: true,
                thinking: thinking,
                output: output
            });

            return {
                role,
                task_description,
                response: output,
                rawResponse: rawResponse,
                thinking: thinking,
                success: true
            };

        } catch (error) {
            this.log(`Task ${taskIndex + 1}: ${role} failed:`, error.message);
            this.onTaskComplete({ taskIndex, role, success: false, error: error.message });

            return {
                role,
                task_description,
                response: `[Error: ${error.message}]`,
                success: false
            };
        }
    }

    /**
     * Execute a model call with tool loop support
     * 
     * If the model requests a tool call, execute it and feed results back
     * until we get a final text response.
     * 
     * @param {array} messages - Current message history
     * @param {array} tools - Available tools (or null)
     * @param {number} taskIndex - Task index for logging
     * @param {number} maxIterations - Maximum tool call iterations
     * @returns {Promise<string>} - Final text response
     */
    async executeWithToolLoop(messages, tools, taskIndex, maxIterations = 5) {
        let iterations = 0;
        let currentMessages = [...messages];

        while (iterations < maxIterations) {
            iterations++;

            const response = await ollamaChat({
                model: this.memberModel,
                messages: currentMessages,
                tools: tools
            });

            const message = response.message;

            // Check if the model wants to call a tool
            if (message.tool_calls && message.tool_calls.length > 0) {
                this.log(`Task ${taskIndex + 1}: Model requested ${message.tool_calls.length} tool call(s)`);
                
                // Add the assistant's message with tool calls to history
                currentMessages.push({
                    role: 'assistant',
                    content: message.content || '',
                    tool_calls: message.tool_calls
                });

                // Execute each tool call and add results
                for (const toolCall of message.tool_calls) {
                    const toolName = toolCall.function.name;
                    let toolArgs;
                    
                    try {
                        toolArgs = typeof toolCall.function.arguments === 'string' 
                            ? JSON.parse(toolCall.function.arguments)
                            : toolCall.function.arguments;
                    } catch (e) {
                        toolArgs = toolCall.function.arguments || {};
                    }

                    this.log(`Task ${taskIndex + 1}: Executing tool '${toolName}' with args:`, toolArgs);
                    this.onToolCall({ taskIndex, toolName, args: toolArgs });

                    try {
                        const toolResult = await executeTool(toolName, toolArgs);
                        
                        // Add tool response to message history
                        currentMessages.push({
                            role: 'tool',
                            content: toolResult
                        });

                    } catch (toolError) {
                        currentMessages.push({
                            role: 'tool',
                            content: JSON.stringify({ error: toolError.message })
                        });
                    }
                }

                // Continue loop to get model's response to tool results
                continue;
            }

            // No tool calls - we have the final response
            return message.content || '';
        }

        throw new Error(`Tool loop exceeded maximum iterations (${maxIterations})`);
    }

    /**
     * PHASE 3: Chairman's Final Synthesis
     * 
     * The Chairman aggregates all council member reports and synthesizes
     * them into a cohesive final answer.
     * 
     * @param {string} originalPrompt - The original user query
     * @param {array} councilResults - Results from Phase 2
     * @returns {Promise<string>} - Final synthesized response
     */
    async executePhase3_FinalSynthesis(originalPrompt, councilResults) {
        this.log('Phase 3: Chairman synthesizing final response...');
        this.onPhaseStart({ phase: 3, name: 'Final Synthesis' });

        // Unload member model before loading chairman model
        await unloadModel(this.memberModel);
        
        // Ensure chairman model is the only one loaded
        await ensureSingleModelLoaded(this.chairmanModel);

        // Format the council reports for the Chairman
        const reportsText = councilResults.map((result, index) => {
            const status = result.success ? '✓' : '✗';
            return `
=== REPORT ${index + 1}: ${result.role} [${status}] ===
Task: ${result.task_description}
Response:
${result.response}
`;
        }).join('\n---\n');

        const systemPrompt = `You are the Chairman of an AI Council. Your council members have completed their assigned tasks, and you must now synthesize their reports into a final, cohesive answer.

INSTRUCTIONS:
1. Review all expert reports carefully
2. Identify key insights and findings from each report
3. Resolve any conflicts or inconsistencies between reports
4. Synthesize everything into a comprehensive, well-structured final answer
5. Ensure the response directly addresses the user's original query
6. Add any additional insights that emerge from combining the reports
7. Format the response clearly with appropriate sections if needed

Your synthesis should be greater than the sum of its parts - combine the expertise into a unified, authoritative response.`;

        const userMessage = `ORIGINAL USER QUERY:
${originalPrompt}

COUNCIL MEMBER REPORTS:
${reportsText}

Please synthesize these expert reports into a final, comprehensive answer to the user's query.`;

        try {
            const response = await ollamaChat({
                model: this.chairmanModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                options: { temperature: 0.5 }
            });

            const rawContent = response.message?.content;
            if (!rawContent) {
                throw new Error('Empty response from Chairman synthesis');
            }

            // Extract thinking from response
            const { thinking, output: finalResponse } = extractThinking(rawContent);

            this.log('Phase 3 Complete. Final synthesis ready.');
            this.onPhaseComplete({ 
                phase: 3, 
                result: finalResponse,
                rawOutput: rawContent,
                thinking: thinking
            });
            
            // Store raw data for final result
            this._phase3Data = { rawOutput: rawContent, thinking };

            return finalResponse;

        } catch (error) {
            this.log('Phase 3 Error:', error.message);
            throw new Error(`Final synthesis failed: ${error.message}`);
        }
    }

    /**
     * Execute the complete AI Council workflow
     * 
     * Main entry point that orchestrates all three phases:
     * 1. Chairman creates execution plan
     * 2. Council members execute tasks SEQUENTIALLY (single-model VRAM)
     * 3. Chairman synthesizes final answer
     * 
     * NOTE: This workflow ensures only ONE model is in VRAM at a time.
     * Models are unloaded before switching between chairman and member models.
     * 
     * @param {string} userPrompt - The user's query
     * @returns {Promise<object>} - Complete result with all phases
     */
    async processQuery(userPrompt) {
        const startTime = Date.now();
        
        this.log('='.repeat(60));
        this.log('AI COUNCIL SESSION STARTED (Single-Model VRAM Mode)');
        this.log('Query:', userPrompt);
        this.log('='.repeat(60));

        try {
            // Phase 1: Chairman's Plan
            const plan = await this.executePhase1_ChairmanPlan(userPrompt);

            // Phase 2: Council Execution
            const councilResults = await this.executePhase2_CouncilExecution(userPrompt, plan);

            // Phase 3: Final Synthesis
            const finalResponse = await this.executePhase3_FinalSynthesis(userPrompt, councilResults);

            const duration = Date.now() - startTime;
            
            this.log('='.repeat(60));
            this.log(`AI COUNCIL SESSION COMPLETED (${duration}ms)`);
            this.log('='.repeat(60));

            return {
                success: true,
                query: userPrompt,
                plan: plan,
                councilResults: councilResults,
                finalResponse: finalResponse,
                // Include phase thinking/output data
                phaseData: {
                    phase1: this._phase1Data || {},
                    phase3: this._phase3Data || {}
                },
                metadata: {
                    duration: duration,
                    chairmanModel: this.chairmanModel,
                    memberModel: this.memberModel,
                    taskCount: plan.length,
                    successfulTasks: councilResults.filter(r => r.success).length
                }
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            
            this.log('='.repeat(60));
            this.log(`AI COUNCIL SESSION FAILED (${duration}ms):`, error.message);
            this.log('='.repeat(60));

            return {
                success: false,
                query: userPrompt,
                error: error.message,
                metadata: {
                    duration: duration,
                    chairmanModel: this.chairmanModel,
                    memberModel: this.memberModel
                }
            };
        }
    }

    /**
     * Health check - verify Ollama connection and model availability
     * 
     * @returns {Promise<object>} - Health status
     */
    async healthCheck() {
        try {
            // Check if Ollama is running
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                throw new Error('Ollama API not responding');
            }

            const data = await response.json();
            const availableModels = data.models?.map(m => m.name) || [];

            // Check if required models are available
            const chairmanAvailable = availableModels.some(m => m.startsWith(this.chairmanModel.split(':')[0]));
            const memberAvailable = availableModels.some(m => m.startsWith(this.memberModel.split(':')[0]));

            return {
                healthy: true,
                ollamaConnected: true,
                availableModels,
                requiredModels: {
                    chairman: { model: this.chairmanModel, available: chairmanAvailable },
                    member: { model: this.memberModel, available: memberAvailable }
                }
            };

        } catch (error) {
            return {
                healthy: false,
                ollamaConnected: false,
                error: error.message
            };
        }
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    AICouncilService,
    WEB_SEARCH_TOOL,
    AVAILABLE_TOOLS,
    executeWebSearch,
    executeTool,
    ollamaChat,
    setSearchFunction,
    unloadModel,
    ensureSingleModelLoaded,
    
    // Configuration exports for customization
    config: {
        OLLAMA_BASE_URL,
        CHAIRMAN_MODEL,
        MEMBER_MODEL
    }
};
