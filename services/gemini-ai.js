const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const config = require('../config/app-config');

const API_KEY_FILE = path.join(__dirname, '..', '.gemini-api-key');
const MODEL_CONFIG_FILE = path.join(__dirname, '..', '.gemini-model-config.json');

// Professional context extracted from CV for prompt personalization
const PROFESSIONAL_CONTEXT = {
    name: 'Andriy Velychko',
    level: 'Middle',
    title: 'Software QA | Test Automation Engineer',
    experience: '3+ years',
    primaryLanguages: ['C# (.NET 8 SDK)', 'Python'],
    secondaryLanguages: ['JavaScript/TypeScript', 'SQL', 'Java'],
    frameworks: {
        csharp: ['NUnit', 'SpecFlow', 'Selenium', 'Playwright', 'FlaUI', 'UIAutomation', 'TestStack.White', 'ExtentReports', 'RestSharp', 'SqlKata', 'Microsoft.Data.SqlClient', 'HtmlAgilityPack', 'NJsonSchema'],
        python: ['Pytest', 'Robot Framework', 'Appium', 'BrowserLibrary'],
        java: ['TestNG', 'JUnit', 'Karate'],
        js: ['Cypress', 'Playwright']
    },
    tools: ['Postman', 'Fiddler', 'Swagger', 'JIRA', 'Confluence', 'Jenkins', 'Azure DevOps', 'Docker', 'Git', 'TestRail'],
    databases: ['MySQL', 'MSSQL', 'PostgreSQL', 'MongoDB'],
    testingTypes: ['Web UI', 'Desktop', 'Mobile', 'API', 'IoT/Hardware', 'E2E', 'Regression', 'Sanity', 'Performance', 'Localization'],
    methodologies: ['Scrum', 'Kanban'],
    targetMarket: 'US remote positions ($10k+/month)',
    companies: ['SoftServe', 'GlobalLogic', 'Appexoft', 'INDEEMA'],
    education: 'CS & IT at Lviv Polytechnic National University (2022-2026)',
    english: 'B2+ Upper-Intermediate',
    projectDomains: ['IoT Plant Care', 'Medical/Nurses Medication Management', 'Cloud Document Management', 'Ecology', 'AI Sports Live-Streaming', 'Sick Leave Management', 'Health & Fitness']
};

class GeminiAIService {
    constructor() {
        this.client = null;
        this.filePersistenceEnabled = !!config.AI_FILE_PERSISTENCE;
        this.availableModels = this._normalizeModelCatalog(config.AI_MODELS);
        this.retryConfig = {
            maxRetriesPerModel: Number(config.AI_RETRY?.maxRetriesPerModel) || 3,
            baseDelayMs: Number(config.AI_RETRY?.baseDelayMs) || 3000,
            maxDelayMs: Number(config.AI_RETRY?.maxDelayMs) || 15000,
            jitterMs: Number(config.AI_RETRY?.jitterMs) || 700
        };
        this.allowModelFallback = config.AI_ALLOW_MODEL_FALLBACK !== false;
        this.modelConfig = this._loadModelConfig();
        this.model = this.modelConfig.activeModel;
        this.apiKey = this._loadApiKey();
        if (this.apiKey) {
            this._initClient();
        }
    }

    _normalizeModelCatalog(models) {
        const fallbackCatalog = [
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'free', recommended: true },
            { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', tier: 'free' },
            { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'free' }
        ];

        const source = Array.isArray(models) && models.length > 0 ? models : fallbackCatalog;
        const normalized = [];
        const seen = new Set();

        source.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            const id = String(entry.id || '').trim();
            if (!id || seen.has(id)) {
                return;
            }

            seen.add(id);
            normalized.push({
                id,
                label: String(entry.label || id),
                tier: String(entry.tier || 'unknown'),
                recommended: !!entry.recommended
            });
        });

        return normalized.length > 0 ? normalized : fallbackCatalog;
    }

    _defaultModelConfig() {
        const configuredDefault = String(config.AI_DEFAULT_MODEL || '').trim();
        const fallbackDefault = this.availableModels[0]?.id;
        const selectedDefault = this.availableModels.some((model) => model.id === configuredDefault)
            ? configuredDefault
            : fallbackDefault;

        const configuredOrder = Array.isArray(config.AI_FALLBACK_ORDER) ? config.AI_FALLBACK_ORDER : [];
        const fallbackOrder = this._normalizeFallbackOrder(configuredOrder, selectedDefault);

        return {
            activeModel: selectedDefault,
            fallbackOrder
        };
    }

    _normalizeFallbackOrder(order, preferredModel) {
        const availableIds = this.availableModels.map((model) => model.id);
        const seen = new Set();
        const normalized = [];

        if (preferredModel && availableIds.includes(preferredModel) && !seen.has(preferredModel)) {
            normalized.push(preferredModel);
            seen.add(preferredModel);
        }

        (Array.isArray(order) ? order : []).forEach((item) => {
            const modelId = String(item || '').trim();
            if (!modelId || !availableIds.includes(modelId) || seen.has(modelId)) {
                return;
            }
            normalized.push(modelId);
            seen.add(modelId);
        });

        availableIds.forEach((modelId) => {
            if (!seen.has(modelId)) {
                normalized.push(modelId);
                seen.add(modelId);
            }
        });

        return normalized;
    }

    _normalizeModelConfig(configValue) {
        const defaults = this._defaultModelConfig();
        const activeCandidate = String(configValue?.activeModel || '').trim();
        const activeModel = this.availableModels.some((model) => model.id === activeCandidate)
            ? activeCandidate
            : defaults.activeModel;

        const fallbackOrder = this._normalizeFallbackOrder(configValue?.fallbackOrder || defaults.fallbackOrder, activeModel);

        return { activeModel, fallbackOrder };
    }

    _loadModelConfig() {
        const defaults = this._defaultModelConfig();

        if (!this.filePersistenceEnabled) {
            return defaults;
        }

        try {
            if (fs.existsSync(MODEL_CONFIG_FILE)) {
                const raw = fs.readFileSync(MODEL_CONFIG_FILE, 'utf8');
                const parsed = JSON.parse(raw);
                const normalized = this._normalizeModelConfig(parsed);
                this._saveModelConfig(normalized);
                return normalized;
            }
        } catch (err) {
            console.error('Error loading model config:', err.message);
        }

        this._saveModelConfig(defaults);
        return defaults;
    }

    _saveModelConfig(modelConfig = this.modelConfig) {
        if (!this.filePersistenceEnabled) {
            return;
        }

        try {
            fs.writeFileSync(MODEL_CONFIG_FILE, JSON.stringify(modelConfig, null, 2), 'utf8');
        } catch (err) {
            console.error('Error saving model config:', err.message);
        }
    }

    _loadApiKey() {
        try {
            if (process.env.GEMINI_API_KEY) {
                return process.env.GEMINI_API_KEY;
            }
            if (this.filePersistenceEnabled && fs.existsSync(API_KEY_FILE)) {
                return fs.readFileSync(API_KEY_FILE, 'utf8').trim();
            }
        } catch (err) {
            console.error('Error loading API key:', err.message);
        }
        return null;
    }

    _initClient() {
        if (this.apiKey) {
            this.client = new GoogleGenerativeAI(this.apiKey);
        }
    }

    setApiKey(key) {
        const nextKey = String(key || '').trim();

        if (!nextKey || nextKey.length < 10) {
            throw new Error('API key is missing or too short.');
        }

        if (process.env.GEMINI_API_KEY) {
            throw new Error('API key is managed by environment variable GEMINI_API_KEY. Update server environment settings and redeploy to change it.');
        }

        this.apiKey = nextKey;

        if (this.filePersistenceEnabled) {
            try {
                fs.writeFileSync(API_KEY_FILE, nextKey, 'utf8');
            } catch (err) {
                console.error('Error saving API key:', err.message);
            }
        }

        this._initClient();
    }

    getApiKeyStatus() {
        const keyLockedByEnvironment = Boolean(process.env.GEMINI_API_KEY);
        const source = process.env.GEMINI_API_KEY
            ? 'environment'
            : (this.apiKey ? (this.filePersistenceEnabled ? 'file' : 'runtime') : 'none');

        return {
            configured: !!this.apiKey,
            source,
            keyLockedByEnvironment,
            maskedKey: this.apiKey ? this.apiKey.slice(0, 6) + '...' + this.apiKey.slice(-4) : null,
            model: this.modelConfig.activeModel,
            activeModel: this.modelConfig.activeModel,
            activeModelLabel: this.getModelLabel(this.modelConfig.activeModel),
            fallbackOrder: [...this.modelConfig.fallbackOrder],
            allowModelFallback: this.allowModelFallback,
            availableModels: [...this.availableModels]
        };
    }

    getModelLabel(modelId) {
        const target = String(modelId || '').trim();
        const match = this.availableModels.find((model) => model.id === target);
        return match ? match.label : target;
    }

    setModel(modelId) {
        const nextModel = String(modelId || '').trim();
        const exists = this.availableModels.some((model) => model.id === nextModel);

        if (!exists) {
            throw new Error('Unsupported model selected.');
        }

        this.modelConfig = this._normalizeModelConfig({
            activeModel: nextModel,
            fallbackOrder: [nextModel, ...this.modelConfig.fallbackOrder]
        });
        this.model = this.modelConfig.activeModel;
        this._saveModelConfig();

        return this.getApiKeyStatus();
    }

    /**
     * Build the professional-grade prompt for generating educational content.
     * Personalized for Middle QA/AQA targeting US market senior positions.
     */
    buildPrompt(topic) {
        const ctx = PROFESSIONAL_CONTEXT;
        const parsedDesc = this._parseDescription(topic.description || '');
        
        const descriptionSection = parsedDesc.descriptions.length > 0
            ? parsedDesc.descriptions.map(d => `- ${d}`).join('\n')
            : '- (No specific description points provided — cover the topic comprehensively based on its title)';
        
        const artifactsSection = parsedDesc.artifacts.length > 0
            ? parsedDesc.artifacts.map(a => `- ${a}`).join('\n')
            : '';

        const categoryContext = topic.category ? `\nCategory: ${topic.category}` : '';
        const moduleContext = topic.module ? `\nModule: ${topic.module}` : '';

        return `You are a Senior Staff QA/SDET Engineer at a top US tech company (FAANG-level). You're writing an in-depth technical reference document for a colleague who is a Middle-level Test Automation Engineer preparing for Senior/Staff QA roles at US companies.

## TOPIC: ${topic.title}
${categoryContext}${moduleContext}

## TOPIC DESCRIPTION
${descriptionSection}
${artifactsSection ? `\n## EXPECTED ARTIFACTS/OUTCOMES\n${artifactsSection}` : ''}

## READER PROFILE
- **Current Level**: Middle QA/AQA Engineer with ${ctx.experience} of production experience
- **Primary Stack**: ${ctx.primaryLanguages.join(', ')} — this is the reader's daily driver stack
- **Familiar With**: ${ctx.secondaryLanguages.join(', ')}
- **C# Frameworks**: ${ctx.frameworks.csharp.join(', ')}
- **Python Stack**: ${ctx.frameworks.python.join(', ')}
- **Testing Types**: ${ctx.testingTypes.join(', ')}
- **Tools**: ${ctx.tools.join(', ')}
- **Real Project Domains**: ${ctx.projectDomains.join(', ')}
- **Target**: US market senior QA/AQA/SDET positions ($120k+/year remote)
- **Education**: ${ctx.education}

## WRITING GUIDELINES

### Tone & Language
- Write like a senior engineer talking to a competent mid-level colleague — NOT dumbed down, NOT academic
- Use real industry slang and terminology as used in US tech companies (e.g., "flaky test", "test harness", "shift-left", "blast radius", "code smell", "happy path", "edge case", "smoke test", "regression suite", "test pyramid", "contract testing", "canary deployment", etc.)
- Be direct and opinionated — share what actually works in production, not textbook theory
- Include "war stories" or realistic scenarios (e.g., "In a CI pipeline with 2000+ tests, if you don't...")
- Don't over-explain basics the reader already knows — reference them briefly and move to advanced usage

### Structure (use all that apply)
1. **TL;DR** — 2-3 sentence executive summary
2. **Core Concepts** — What this topic really is and why it matters in production
3. **How It Works** — Technical deep-dive with architecture/flow explanations
4. **Practical Implementation** — Step-by-step with real code examples
5. **C# Examples** — Production-quality examples using NUnit/Selenium/RestSharp/SpecFlow where relevant
6. **Python Examples** — Equivalent examples using Pytest/Robot Framework where relevant
7. **Common Pitfalls & Anti-Patterns** — Real mistakes from production, not theoretical ones
8. **Best Practices** — Battle-tested patterns used at scale
9. **Interview Prep** — 3-5 questions a US interviewer might ask about this topic + solid answers
10. **Further Reading** — Links or references to official docs, key blog posts, or conference talks

### Code Quality
- All code examples must be production-quality — proper error handling, logging, design patterns
- Use .NET 8 / C# 12 syntax (global usings, file-scoped namespaces, primary constructors where appropriate)
- Python examples should use modern idioms (type hints, dataclasses, context managers)
- Show test code in context of a real framework setup (not isolated snippets)
- Include both positive and negative test cases
- Show how the concept integrates with CI/CD where relevant

### Content Depth
- This is a long-read reference document, not a quick summary — be thorough
- Include diagrams using Mermaid syntax in fenced code blocks (\`\`\`mermaid) where they help understanding (e.g., flowcharts, sequence diagrams, class diagrams)
- When writing Mermaid diagrams, add spaces inside brackets for readability: \`A[ My Node ]\` not \`A[My Node]\`, \`B{ Decision }\` not \`B{Decision}\`
- Compare approaches (e.g., Page Object vs Screenplay, xUnit vs BDD)
- Cover both the "what" and the "why" — explain trade-offs and decision criteria
- Reference real tools/libraries by name with version-specific details where relevant

Use Markdown formatting throughout: headers (##, ###), code blocks with language tags (\`\`\`csharp, \`\`\`python, \`\`\`mermaid), tables, bullet points, blockquotes for important notes, and bold/italic for emphasis.`;
    }

    /**
     * Build a prompt for explaining an unknown term/concept (inline learning assistant)
     */
    buildExplainPrompt(term, sourceTopicTitle, sourceContext) {
        return `You are a Senior QA/SDET Engineer explaining a technical term to a Mid-level Test Automation Engineer (C#/Python stack, 3+ years experience).

**Term to explain**: "${term}"
${sourceTopicTitle ? `**Found while studying**: ${sourceTopicTitle}` : ''}
${sourceContext ? `**Context**: "${sourceContext}"` : ''}

Provide a concise but technically accurate explanation:

1. **What it is** — One clear definition (1-2 sentences)
2. **Why it matters** — Why a QA/AQA engineer should care (1-2 sentences)
3. **Quick example** — A minimal code snippet or real-world scenario (if applicable)
4. **Related concepts** — 2-3 related terms the reader should also know

Keep it focused and practical — under 300 words total. Use Markdown formatting.`;
    }

    /**
     * Parse topic description into structured sections
     */
    _parseDescription(description) {
        if (!description) return { descriptions: [], artifacts: [], other: [] };
        
        const result = { descriptions: [], artifacts: [], other: [] };
        const sections = description.split(/\*\*(.*?)\*\*/);
        
        let currentSection = 'descriptions';
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i].trim();
            
            if (section.toLowerCase().includes('description')) {
                currentSection = 'descriptions';
            } else if (section.toLowerCase().includes('artifact')) {
                currentSection = 'artifacts';
            } else if (section.toLowerCase().includes('nebo') || section.toLowerCase().includes('outcome') || 
                      section.toLowerCase().includes('learning') || section.toLowerCase().includes('additional')) {
                currentSection = 'other';
            } else if (section.length > 0) {
                const items = section.split(/\n•|\n/).filter(item => item.trim().length > 0);
                items.forEach(item => {
                    const cleanItem = item.replace(/^•\s*/, '').trim();
                    if (cleanItem) {
                        result[currentSection].push(cleanItem);
                    }
                });
            }
        }
        
        return result;
    }

    _isRetryableOverloadError(message) {
        const msg = String(message || '');
        return msg.includes('503')
            || msg.includes('Service Unavailable')
            || msg.includes('overloaded')
            || msg.includes('high demand')
            || msg.includes('UNAVAILABLE');
    }

    _isRateLimitError(message) {
        const msg = String(message || '');
        return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429');
    }

    _computeRetryDelay(attempt) {
        const linearDelay = this.retryConfig.baseDelayMs * attempt;
        const cappedDelay = Math.min(linearDelay, this.retryConfig.maxDelayMs);
        const jitter = Math.floor(Math.random() * (this.retryConfig.jitterMs + 1));
        return cappedDelay + jitter;
    }

    _getModelSequence() {
        const normalized = this._normalizeFallbackOrder(this.modelConfig.fallbackOrder, this.modelConfig.activeModel);

        if (!this.allowModelFallback) {
            return normalized.length > 0 ? [normalized[0]] : [];
        }

        return normalized;
    }

    async _generateWithFallback(prompt, generationConfig, operationLabel, maxRetriesPerModel) {
        const modelSequence = this._getModelSequence();
        const retries = Number(maxRetriesPerModel) || this.retryConfig.maxRetriesPerModel;
        const attemptLog = [];
        let lastError = null;

        for (const modelId of modelSequence) {
            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    const model = this.client.getGenerativeModel({
                        model: modelId,
                        generationConfig
                    });

                    const result = await model.generateContent(prompt);
                    return {
                        result,
                        modelId,
                        fallbackUsed: modelId !== this.modelConfig.activeModel,
                        attemptCount: attemptLog.length + 1,
                        attemptedModels: [...new Set([...attemptLog.map((entry) => entry.model), modelId])]
                    };
                } catch (error) {
                    const message = error.message || '';
                    attemptLog.push({ model: modelId, attempt, message });
                    lastError = error;

                    if (this._isRateLimitError(message)) {
                        this._handleApiError(error);
                    }

                    if (this._isRetryableOverloadError(message) && attempt < retries) {
                        const delay = this._computeRetryDelay(attempt);
                        console.log(`[Gemini:${operationLabel}] ${modelId} overloaded on attempt ${attempt}/${retries}, retrying in ${Math.round(delay / 1000)}s...`);
                        await new Promise((resolve) => setTimeout(resolve, delay));
                        continue;
                    }

                    break;
                }
            }
        }

        if (lastError && this._isRetryableOverloadError(lastError.message || '')) {
            throw new Error('Gemini is temporarily overloaded (503) on all configured models. Automatic retries were exhausted. Please try again in a few minutes.');
        }

        this._handleApiError(lastError || new Error('Gemini request failed.'));
    }

    /**
     * Generate educational content for a topic with model fallback.
     */
    async generateContent(topic) {
        if (!this.client) {
            throw new Error('Gemini API key not configured. Please set your API key in Settings.');
        }

        const prompt = this.buildPrompt(topic);
        const generated = await this._generateWithFallback(
            prompt,
            {
                maxOutputTokens: 65536,
                temperature: 0.8
            },
            'generate',
            this.retryConfig.maxRetriesPerModel
        );

        const response = generated.result.response;
        const generatedText = response.text();

        if (!generatedText || generatedText.trim().length === 0) {
            throw new Error('Gemini returned empty response');
        }

        const finishReason = response.candidates?.[0]?.finishReason;
        const isTruncated = finishReason === 'MAX_TOKENS';
        const usage = response.usageMetadata || {};

        return {
            content: generatedText,
            model: generated.modelId,
            modelLabel: this.getModelLabel(generated.modelId),
            activeModel: this.modelConfig.activeModel,
            fallbackUsed: generated.fallbackUsed,
            attempts: generated.attemptCount,
            attemptedModels: generated.attemptedModels,
            usage: {
                promptTokens: usage.promptTokenCount || 0,
                completionTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0,
                thoughtsTokenCount: usage.thoughtsTokenCount || 0
            },
            stopReason: finishReason || 'STOP',
            isTruncated,
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Explain a term/concept using AI with model fallback.
     */
    async explainTerm(term, sourceTopicTitle, sourceContext) {
        if (!this.client) {
            throw new Error('Gemini API key not configured.');
        }

        const prompt = this.buildExplainPrompt(term, sourceTopicTitle, sourceContext);
        const generated = await this._generateWithFallback(
            prompt,
            {
                maxOutputTokens: 2048,
                temperature: 0.6
            },
            'explain',
            Math.max(2, this.retryConfig.maxRetriesPerModel - 1)
        );

        const response = generated.result.response;
        const text = response.text();

        if (!text || text.trim().length === 0) {
            throw new Error('Gemini returned empty explanation');
        }

        return {
            term,
            explanation: text,
            model: generated.modelId,
            modelLabel: this.getModelLabel(generated.modelId),
            activeModel: this.modelConfig.activeModel,
            fallbackUsed: generated.fallbackUsed,
            attempts: generated.attemptCount,
            attemptedModels: generated.attemptedModels,
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Common API error handler
     */
    _handleApiError(error) {
        const message = error.message || '';
        if (message.includes('API_KEY_INVALID') || message.includes('API key not valid')) {
            throw new Error('Invalid API key. Please check your Google Gemini API key in Settings. Get a free key at aistudio.google.com');
        }
        if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
            throw new Error('Rate limited. Free tier allows 15 requests/minute. Please wait and try again.');
        }
        if (message.includes('models/') || message.includes('Model not found') || message.includes('not supported for this request')) {
            throw new Error('Selected model is unavailable for this request. Please switch model in AI Settings and try again.');
        }
        if (message.includes('503') || message.includes('Service Unavailable') || message.includes('high demand') || message.includes('UNAVAILABLE')) {
            throw new Error('Gemini is temporarily overloaded (503). Please try again in a few minutes.');
        }
        if (message.includes('PERMISSION_DENIED')) {
            throw new Error('Permission denied. Make sure the Gemini API is enabled for your key.');
        }
        throw error;
    }
}

module.exports = GeminiAIService;
