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
        this.runtimeApiKeyOverride = false;
        this.filePersistenceEnabled = !!config.AI_FILE_PERSISTENCE;
        this.availableModels = this._normalizeModelCatalog(config.AI_MODELS);
        this.retryConfig = {
            maxRetriesPerModel: Number(config.AI_RETRY?.maxRetriesPerModel) || 4,
            baseDelayMs: Number(config.AI_RETRY?.baseDelayMs) || 3000,
            maxDelayMs: Number(config.AI_RETRY?.maxDelayMs) || 15000,
            jitterMs: Number(config.AI_RETRY?.jitterMs) || 700
        };
        this.generationLimits = {
            generateMaxOutputTokens: Math.max(2048, Number(config.AI_GENERATE_MAX_OUTPUT_TOKENS) || 12288),
            generateReducedOutputTokens: Math.max(2048, Number(config.AI_GENERATE_REDUCED_OUTPUT_TOKENS) || 8192),
            generateEmergencyOutputTokens: Math.max(1024, Number(config.AI_GENERATE_EMERGENCY_OUTPUT_TOKENS) || 6144),
            explainMaxOutputTokens: Math.max(512, Number(config.AI_EXPLAIN_MAX_OUTPUT_TOKENS) || 2048)
        };

        if (this.generationLimits.generateReducedOutputTokens >= this.generationLimits.generateMaxOutputTokens) {
            this.generationLimits.generateReducedOutputTokens = Math.max(
                2048,
                Math.floor(this.generationLimits.generateMaxOutputTokens * 0.67)
            );
        }

        if (this.generationLimits.generateEmergencyOutputTokens >= this.generationLimits.generateReducedOutputTokens) {
            this.generationLimits.generateEmergencyOutputTokens = Math.max(
                1024,
                Math.floor(this.generationLimits.generateReducedOutputTokens * 0.75)
            );
        }
        this.allowModelFallback = config.AI_ALLOW_MODEL_FALLBACK !== false;
        this.allowStrictOverloadModelEscape = config.AI_ALLOW_STRICT_OVERLOAD_MODEL_ESCAPE !== false;
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
        const envKey = String(process.env.GEMINI_API_KEY || '').trim();
        const hasEnvKey = Boolean(envKey);

        if (!nextKey || nextKey.length < 10) {
            throw new Error('API key is missing or too short.');
        }

        this.apiKey = nextKey;
        this.runtimeApiKeyOverride = hasEnvKey && nextKey !== envKey;

        if (this.filePersistenceEnabled && !hasEnvKey) {
            try {
                fs.writeFileSync(API_KEY_FILE, nextKey, 'utf8');
            } catch (err) {
                console.error('Error saving API key:', err.message);
            }
        }

        this._initClient();
    }

    getApiKeyStatus() {
        const envKey = String(process.env.GEMINI_API_KEY || '').trim();
        const keyLockedByEnvironment = Boolean(envKey);
        const runtimeOverrideActive = keyLockedByEnvironment && this.runtimeApiKeyOverride;
        const source = runtimeOverrideActive
            ? 'runtime-override'
            : (keyLockedByEnvironment
                ? 'environment'
                : (this.apiKey ? (this.filePersistenceEnabled ? 'file' : 'runtime') : 'none'));

        return {
            configured: !!this.apiKey,
            source,
            keyLockedByEnvironment,
            canOverrideEnvironmentKey: keyLockedByEnvironment,
            runtimeOverrideActive,
            maskedKey: this.apiKey ? this.apiKey.slice(0, 6) + '...' + this.apiKey.slice(-4) : null,
            model: this.modelConfig.activeModel,
            activeModel: this.modelConfig.activeModel,
            activeModelLabel: this.getModelLabel(this.modelConfig.activeModel),
            fallbackOrder: [...this.modelConfig.fallbackOrder],
            allowModelFallback: this.allowModelFallback,
            allowStrictOverloadModelEscape: this.allowStrictOverloadModelEscape,
            generationLimits: {
                generateMaxOutputTokens: this.generationLimits.generateMaxOutputTokens,
                generateReducedOutputTokens: this.generationLimits.generateReducedOutputTokens,
                generateEmergencyOutputTokens: this.generationLimits.generateEmergencyOutputTokens,
                explainMaxOutputTokens: this.generationLimits.explainMaxOutputTokens
            },
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
        if (topic.category === 'Books') {
            return this.buildBookStudyPrompt(topic);
        }

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
     * Build the prompt for topics that come from a study book/certification syllabus
     * (topic.category === 'Books'). Unlike buildPrompt() above — which targets hands-on
     * production engineering — this targets exam prep: definitions, terminology precision,
     * and practice questions, since that's what a candidate actually needs from a chapter.
     */
    buildBookStudyPrompt(topic) {
        const moduleContext = topic.module ? `\nBook / Chapter: ${topic.module}` : '';
        const notesContext = topic.notes ? `\n\n## STUDY SOURCE\n${topic.notes}` : '';
        const selfCheckItems = Array.isArray(topic.questions) && topic.questions.length > 0
            ? topic.questions.map(q => `- ${typeof q === 'string' ? q : q.text}`).join('\n')
            : '';

        return `You are an experienced certification trainer writing exam-prep study notes for a candidate preparing for a professional certification exam (e.g. ISTQB). The candidate already owns the official book/syllabus for this section — your job is to distill and reinforce it, not replace it.

## SYLLABUS SECTION: ${topic.title}
${moduleContext}
${notesContext}

${selfCheckItems ? `## SELF-CHECK ITEMS TO COVER\n${selfCheckItems}\n` : ''}
## WRITING GUIDELINES

### Tone
- Clear, precise, exam-focused — like a trainer's study notes, not marketing copy
- Use the exact terminology the certification body uses; call out terms that are easy to confuse (e.g. similar-sounding concepts, common trick-question pairs)
- Do not fabricate specific official Learning Objective codes or K-levels (K1–K4) if you are not certain of the exact current wording — describe the objective in plain language instead, and note that the reader should cross-check exact LO codes against the official syllabus PDF

### Structure (use all that apply)
1. **TL;DR** — 2-3 sentence summary of what this section covers and why it matters for the exam
2. **Key Concepts** — clear definitions of every important term in this section
3. **Deep Dive** — explain the concept thoroughly, with realistic examples
4. **Commonly Confused With** — terms/concepts candidates often mix up in this area, and how to tell them apart
5. **Common Exam Traps** — the kinds of distractor answers exams typically use for this topic, and how to spot them
6. **Practice Questions** — 4-6 exam-style multiple-choice questions (4 options each) covering this section, with the correct answer and a one-line rationale for each — clearly mark which option is correct
7. **Quick Recap** — a short bullet-point summary for last-minute review

Use Markdown formatting throughout: headers (##, ###), tables where useful for comparisons, bullet points, and bold for key terms.`;
    }

    /**
     * Build a prompt asking for structured JSON multiple-choice questions for a topic.
     * Used for scored practice quizzes / mock exams, distinct from the free-form
     * "Practice Questions" markdown section in buildBookStudyPrompt (that one is for
     * reading, this one produces machine-scorable questions).
     */
    buildQuizPrompt(topic) {
        const moduleContext = topic.module ? `\nBook / Chapter: ${topic.module}` : '';
        const notesContext = topic.notes ? `\n${topic.notes}` : '';

        return `You are a certification exam item writer. Write 6 multiple-choice questions testing understanding of the following syllabus section, in the style of a real certification exam (e.g. ISTQB).

## SECTION: ${topic.title}
${moduleContext}${notesContext}

## RULES
- Exactly 4 options per question, only one correct.
- Vary which option index (0-3) is correct across questions — don't always put the answer in the same position.
- Distractor (wrong) options must be plausible, not obviously silly — use common misconceptions or easily-confused terms.
- Keep each question and option concise (1-2 sentences max).
- Write a one-sentence explanation of why the correct answer is right.
- Do not invent specific official Learning Objective codes/K-levels; test conceptual understanding instead.

## OUTPUT FORMAT
Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."}]}`;
    }

    /**
     * Generate a scored 6-question MCQ quiz for a topic. Unlike generateContent(),
     * this asks for strict JSON so answers can be checked server-side.
     */
    async generateQuiz(topic) {
        if (!this.client) {
            throw new Error('Gemini API key not configured. Please set your API key in Settings.');
        }

        const prompt = this.buildQuizPrompt(topic);
        const generated = await this._generateWithFallback(
            prompt,
            {
                // 6 questions x (question + 4 options + explanation) can run long with a
                // verbose model — generous headroom avoids truncating mid-object. Even so,
                // _salvageQuizQuestions() below is the real safety net if this isn't enough.
                maxOutputTokens: 6144,
                temperature: 0.7,
                responseMimeType: 'application/json'
            },
            'quiz',
            Math.max(2, this.retryConfig.maxRetriesPerModel - 1)
        );

        const text = generated.result.response.text();
        if (!text || text.trim().length === 0) {
            throw new Error('Gemini returned an empty quiz response');
        }

        let parsed;
        try {
            // Defensive: strip ```json fences in case a fallback model ignores responseMimeType
            const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
            parsed = JSON.parse(cleaned);
        } catch (parseError) {
            // Output got cut off before the JSON closed (hit the token cap mid-object).
            // Salvage whichever questions are already complete instead of failing outright.
            const salvaged = this._salvageQuizQuestions(text);
            if (salvaged.length === 0) {
                throw new Error('Gemini returned malformed quiz JSON: ' + parseError.message);
            }
            console.warn(`[Gemini:quiz] Response JSON was truncated; salvaged ${salvaged.length} complete question(s).`);
            parsed = { questions: salvaged };
        }

        const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        const validQuestions = questions.filter(q =>
            q && typeof q.question === 'string' &&
            Array.isArray(q.options) && q.options.length === 4 &&
            Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3
        );

        if (validQuestions.length === 0) {
            throw new Error('Gemini did not return any valid quiz questions');
        }

        return {
            questions: validQuestions,
            model: generated.modelId,
            modelLabel: this.getModelLabel(generated.modelId),
            fallbackUsed: generated.fallbackUsed,
            generatedAt: new Date().toISOString()
        };
    }

    // Best-effort recovery for a quiz response that got cut off mid-JSON (hit the
    // token cap before closing). Scans past the "questions":[ array opener and pulls
    // out every complete {...} object it finds, string-aware so braces inside question
    // text don't throw off the depth count; the trailing incomplete object (if any) is
    // silently dropped rather than causing the whole quiz generation to fail.
    _salvageQuizQuestions(rawText) {
        const questionsKeyIndex = rawText.indexOf('"questions"');
        const arrayStart = rawText.indexOf('[', questionsKeyIndex === -1 ? 0 : questionsKeyIndex);
        if (arrayStart === -1) return [];

        const arrayText = rawText.slice(arrayStart + 1);
        const objects = [];
        let depth = 0;
        let objectStart = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < arrayText.length; i++) {
            const ch = arrayText[i];

            if (escapeNext) { escapeNext = false; continue; }
            if (ch === '\\' && inString) { escapeNext = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;

            if (ch === '{') {
                if (depth === 0) objectStart = i;
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0 && objectStart !== -1) {
                    try {
                        objects.push(JSON.parse(arrayText.slice(objectStart, i + 1)));
                    } catch (e) {
                        // Malformed even standalone — skip it
                    }
                    objectStart = -1;
                }
            }
        }

        return objects;
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
        const safeAttempt = Math.max(1, Number(attempt) || 1);
        const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, safeAttempt - 1);
        const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);
        const jitter = Math.floor(Math.random() * (this.retryConfig.jitterMs + 1));
        return cappedDelay + jitter;
    }

    _getModelSequence(allowFallbackOverride = null) {
        const normalized = this._normalizeFallbackOrder(this.modelConfig.fallbackOrder, this.modelConfig.activeModel);
        const allowFallback = typeof allowFallbackOverride === 'boolean'
            ? allowFallbackOverride
            : this.allowModelFallback;

        if (!allowFallback) {
            return normalized.length > 0 ? [normalized[0]] : [];
        }

        return normalized;
    }

    _getStrictOverloadEscapeModelSequence() {
        const normalized = this._normalizeFallbackOrder(this.modelConfig.fallbackOrder, this.modelConfig.activeModel);
        return normalized.filter((modelId) => modelId !== this.modelConfig.activeModel);
    }

    async _generateWithFallback(prompt, generationConfig, operationLabel, maxRetriesPerModel, options = {}) {
        const explicitModelSequence = Array.isArray(options.modelSequence)
            ? options.modelSequence.map((modelId) => String(modelId || '').trim()).filter(Boolean)
            : null;
        const modelSequence = explicitModelSequence && explicitModelSequence.length > 0
            ? explicitModelSequence
            : this._getModelSequence(options.allowModelFallbackOverride);
        const retries = Number(maxRetriesPerModel) || this.retryConfig.maxRetriesPerModel;
        const attemptLog = [];
        let lastError = null;

        if (modelSequence.length === 0) {
            throw new Error('No AI models are configured for generation.');
        }

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
            if (modelSequence.length <= 1) {
                const modelLabel = this.getModelLabel(modelSequence[0] || this.modelConfig.activeModel);
                throw new Error(`${modelLabel} is temporarily overloaded (503). Automatic retries were exhausted. Please try again in a few minutes.`);
            }

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
        const primaryGenerationConfig = {
            maxOutputTokens: this.generationLimits.generateMaxOutputTokens,
            temperature: 0.8
        };

        let generated;
        let generationProfile = 'standard';
        let maxOutputTokensRequested = primaryGenerationConfig.maxOutputTokens;
        let strictOverloadModelEscapeUsed = false;
        const fallbackFastRetries = Math.max(1, Math.min(2, this.retryConfig.maxRetriesPerModel));
        const primaryRetries = this.allowModelFallback ? fallbackFastRetries : this.retryConfig.maxRetriesPerModel;
        const reducedRetries = this.allowModelFallback
            ? fallbackFastRetries
            : Math.max(2, this.retryConfig.maxRetriesPerModel - 1);
        const emergencyRetries = this.allowModelFallback
            ? 1
            : Math.max(1, this.retryConfig.maxRetriesPerModel - 2);

        try {
            generated = await this._generateWithFallback(
                prompt,
                primaryGenerationConfig,
                'generate',
                primaryRetries
            );
        } catch (error) {
            const message = error.message || '';
            const retryWithReducedProfile = this._isRetryableOverloadError(message)
                || message.includes('temporarily overloaded (503)');

            if (!retryWithReducedProfile) {
                throw error;
            }

            try {
                const reducedGenerationConfig = {
                    maxOutputTokens: this.generationLimits.generateReducedOutputTokens,
                    temperature: 0.75
                };

                generated = await this._generateWithFallback(
                    prompt,
                    reducedGenerationConfig,
                    'generate-reduced',
                    reducedRetries
                );
                generationProfile = 'reduced-output';
                maxOutputTokensRequested = reducedGenerationConfig.maxOutputTokens;
            } catch (reducedError) {
                const reducedMessage = reducedError.message || '';
                const retryWithEmergencyProfile = this._isRetryableOverloadError(reducedMessage)
                    || reducedMessage.includes('temporarily overloaded (503)');

                if (!retryWithEmergencyProfile) {
                    throw reducedError;
                }

                const emergencyGenerationConfig = {
                    maxOutputTokens: this.generationLimits.generateEmergencyOutputTokens,
                    temperature: 0.65
                };
                try {
                    generated = await this._generateWithFallback(
                        prompt,
                        emergencyGenerationConfig,
                        'generate-emergency',
                        emergencyRetries
                    );
                    generationProfile = 'emergency-low-output';
                    maxOutputTokensRequested = emergencyGenerationConfig.maxOutputTokens;
                } catch (emergencyError) {
                    const emergencyMessage = emergencyError.message || '';
                    const retryWithStrictEscape = this.allowStrictOverloadModelEscape
                        && !this.allowModelFallback
                        && (this._isRetryableOverloadError(emergencyMessage)
                            || emergencyMessage.includes('temporarily overloaded (503)'));

                    if (!retryWithStrictEscape) {
                        throw emergencyError;
                    }

                    const strictEscapeModelSequence = this._getStrictOverloadEscapeModelSequence();
                    if (strictEscapeModelSequence.length === 0) {
                        throw emergencyError;
                    }

                    const strictEscapeGenerationConfig = {
                        maxOutputTokens: Math.max(1024, Math.min(this.generationLimits.generateEmergencyOutputTokens, 2048)),
                        temperature: 0.6
                    };

                    generated = await this._generateWithFallback(
                        prompt,
                        strictEscapeGenerationConfig,
                        'generate-strict-escape',
                        Math.max(2, this.retryConfig.maxRetriesPerModel - 2),
                        {
                            modelSequence: strictEscapeModelSequence,
                            allowModelFallbackOverride: true
                        }
                    );
                    generationProfile = 'strict-overload-model-escape';
                    maxOutputTokensRequested = strictEscapeGenerationConfig.maxOutputTokens;
                    strictOverloadModelEscapeUsed = true;
                }
            }
        }

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
            generationProfile,
            maxOutputTokensRequested,
            strictOverloadModelEscapeUsed,
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
                maxOutputTokens: this.generationLimits.explainMaxOutputTokens,
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
