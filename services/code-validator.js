const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

class CodeValidatorService {
    constructor(options = {}) {
        this.timeoutMs = Number(options.timeoutMs) || 12000;
        this.dotnetTimeoutMs = Number(options.dotnetTimeoutMs) || 20000;
        this.maxDiagnostics = Number(options.maxDiagnostics) || 8;
        this.maxCodeLength = Number(options.maxCodeLength) || 50000;
    }

    normalizeLanguage(language) {
        const value = String(language || '').trim().toLowerCase();

        if (['python', 'py'].includes(value)) {
            return 'python';
        }

        if (['c#', 'csharp', 'cs', 'dotnet', 'c-sharp'].includes(value)) {
            return 'csharp';
        }

        return null;
    }

    async validate(language, code) {
        const normalizedLanguage = this.normalizeLanguage(language);
        const safeCode = typeof code === 'string' ? code : '';

        if (!normalizedLanguage) {
            return this._withEducationalHints(
                this._simulateValidation(language, safeCode, 'Real validation is only supported for Python and C#.'),
                safeCode,
                normalizedLanguage || 'text'
            );
        }

        if (!safeCode.trim()) {
            return {
                language: normalizedLanguage,
                mode: 'simulated',
                isValid: false,
                summary: 'No code to validate.',
                errors: ['Please add code in Edit mode before running validation.'],
                warnings: [],
                hints: ['Start with a small function or class and then validate incrementally.'],
                engine: 'heuristic'
            };
        }

        if (safeCode.length > this.maxCodeLength) {
            return this._withEducationalHints(
                this._simulateValidation(normalizedLanguage, safeCode, `Code is too long for runtime validation (max ${this.maxCodeLength} chars).`),
                safeCode,
                normalizedLanguage
            );
        }

        try {
            let result;
            if (normalizedLanguage === 'python') {
                result = await this._validatePythonReal(safeCode);
            } else {
                result = await this._validateCSharpReal(safeCode);
            }

            return this._withEducationalHints(result, safeCode, normalizedLanguage);
        } catch (error) {
            const fallback = this._simulateValidation(
                normalizedLanguage,
                safeCode,
                `Real validation unavailable: ${error.message}`
            );
            return this._withEducationalHints(fallback, safeCode, normalizedLanguage);
        }
    }

    async _validatePythonReal(code) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-road-python-'));
        const snippetPath = path.join(tempDir, 'snippet.py');
        fs.writeFileSync(snippetPath, code, 'utf8');

        try {
            const attempts = [
                { command: 'py', args: ['-3', '-m', 'py_compile', snippetPath] },
                { command: 'python', args: ['-m', 'py_compile', snippetPath] }
            ];

            let commandResult = null;

            for (const attempt of attempts) {
                try {
                    commandResult = await this._runCommand(attempt.command, attempt.args, {
                        timeoutMs: this.timeoutMs,
                        cwd: tempDir
                    });
                    break;
                } catch (error) {
                    if (error && error.code === 'ENOENT') {
                        continue;
                    }
                    throw error;
                }
            }

            if (!commandResult) {
                throw new Error('Python executable not found (tried py and python).');
            }

            if (commandResult.timedOut) {
                throw new Error('Python syntax check timed out.');
            }

            if (commandResult.exitCode === 0) {
                return {
                    language: 'python',
                    mode: 'real',
                    isValid: true,
                    summary: 'Python syntax check passed.',
                    errors: [],
                    warnings: [],
                    hints: [],
                    engine: 'py_compile'
                };
            }

            const diagnostics = this._extractPythonDiagnostics(`${commandResult.stdout}\n${commandResult.stderr}`);
            return {
                language: 'python',
                mode: 'real',
                isValid: false,
                summary: 'Python syntax check found issues.',
                errors: diagnostics.errors,
                warnings: diagnostics.warnings,
                hints: [],
                engine: 'py_compile'
            };
        } finally {
            this._cleanupTempDir(tempDir);
        }
    }

    async _validateCSharpReal(code) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-road-csharp-'));
        const projectKind = this._looksLikeCSharpCompilationUnit(code) ? 'library' : 'console';
        const projectFilePath = path.join(tempDir, 'Validator.csproj');
        const snippetPath = path.join(tempDir, 'Snippet.cs');

        fs.writeFileSync(projectFilePath, this._buildCSharpProject(projectKind), 'utf8');
        fs.writeFileSync(snippetPath, code, 'utf8');

        try {
            const result = await this._runCommand(
                'dotnet',
                ['build', projectFilePath, '-nologo', '-v', 'minimal'],
                {
                    timeoutMs: this.dotnetTimeoutMs,
                    cwd: tempDir
                }
            );

            if (result.timedOut) {
                throw new Error('C# validation timed out.');
            }

            const diagnostics = this._extractCSharpDiagnostics(`${result.stdout}\n${result.stderr}`);
            if (result.exitCode === 0 && diagnostics.errors.length === 0) {
                return {
                    language: 'csharp',
                    mode: 'real',
                    isValid: true,
                    summary: 'C# build validation passed.',
                    errors: [],
                    warnings: diagnostics.warnings,
                    hints: [],
                    engine: 'dotnet build'
                };
            }

            return {
                language: 'csharp',
                mode: 'real',
                isValid: false,
                summary: 'C# build validation found issues.',
                errors: diagnostics.errors,
                warnings: diagnostics.warnings,
                hints: [],
                engine: 'dotnet build'
            };
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                throw new Error('dotnet SDK is not available on this machine.');
            }
            throw error;
        } finally {
            this._cleanupTempDir(tempDir);
        }
    }

    _buildCSharpProject(projectKind) {
        const outputType = projectKind === 'console' ? '<OutputType>Exe</OutputType>' : '';
        return `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    ${outputType}\n    <Nullable>disable</Nullable>\n    <ImplicitUsings>disable</ImplicitUsings>\n    <LangVersion>latest</LangVersion>\n  </PropertyGroup>\n</Project>\n`;
    }

    _looksLikeCSharpCompilationUnit(code) {
        const source = String(code || '');
        return /\b(namespace|class|record|struct|interface|enum)\b/.test(source);
    }

    _extractPythonDiagnostics(output) {
        const errors = [];
        const warnings = [];

        const lines = String(output || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        lines.forEach((line) => {
            if (/syntaxerror|indentationerror|taberror/i.test(line)) {
                errors.push(line);
            } else if (/traceback|file\s+"/i.test(line)) {
                warnings.push(line);
            }
        });

        if (errors.length === 0 && lines.length > 0) {
            errors.push(lines.slice(-2).join(' | '));
        }

        return {
            errors: errors.slice(0, this.maxDiagnostics),
            warnings: warnings.slice(0, this.maxDiagnostics)
        };
    }

    _extractCSharpDiagnostics(output) {
        const errors = [];
        const warnings = [];

        const lines = String(output || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        const diagnosticPattern = /\((\d+),(\d+)\):\s*(error|warning)\s*(CS\d+):\s*(.*)$/i;

        lines.forEach((line) => {
            const match = line.match(diagnosticPattern);
            if (!match) {
                return;
            }

            const lineNo = match[1];
            const colNo = match[2];
            const severity = match[3].toLowerCase();
            const code = match[4];
            const message = match[5];
            const formatted = `${code}: ${message} (line ${lineNo}, col ${colNo})`;

            if (severity === 'error') {
                errors.push(formatted);
            } else {
                warnings.push(formatted);
            }
        });

        if (errors.length === 0 && /build failed/i.test(output || '')) {
            errors.push('Build failed, but no structured diagnostics were parsed.');
        }

        return {
            errors: errors.slice(0, this.maxDiagnostics),
            warnings: warnings.slice(0, this.maxDiagnostics)
        };
    }

    _simulateValidation(language, code, reason) {
        const normalizedLanguage = this.normalizeLanguage(language) || 'text';
        const source = String(code || '');
        const errors = [];
        const warnings = [];
        const hints = [];

        if (reason) {
            warnings.push(reason);
        }

        const bracketBalance = this._checkBracketBalance(source);
        if (!bracketBalance.ok) {
            errors.push(bracketBalance.message);
        }

        const lines = source.split(/\r?\n/);

        if (normalizedLanguage === 'python') {
            lines.forEach((line, index) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) {
                    return;
                }

                if (/^(if|elif|else|for|while|def|class|try|except|finally|with)\b/.test(trimmed) && !trimmed.endsWith(':')) {
                    errors.push(`Line ${index + 1} likely needs a trailing ':'`);
                }

                if (/^\t+/.test(line) && /^ +/.test(line)) {
                    warnings.push(`Line ${index + 1} mixes tabs and spaces.`);
                }
            });

            hints.push('For Python, fix the first syntax error before reviewing downstream issues.');
            hints.push('Add a tiny runnable example or a test case after syntax becomes clean.');
        }

        if (normalizedLanguage === 'csharp') {
            lines.forEach((line, index) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('//')) {
                    return;
                }

                const probablyNeedsSemicolon =
                    /\b(return|throw|break|continue)\b/.test(trimmed)
                    || /\b(var|int|string|bool|double|decimal|long|float|object)\b/.test(trimmed)
                    || /\w+\s*=\s*[^=].*/.test(trimmed);

                if (
                    probablyNeedsSemicolon
                    && !trimmed.endsWith(';')
                    && !trimmed.endsWith('{')
                    && !trimmed.endsWith('}')
                ) {
                    warnings.push(`Line ${index + 1} may be missing a semicolon.`);
                }
            });

            hints.push('For C#, compile often and fix errors top-down to reduce cascading diagnostics.');
            hints.push('Prefer extracting logic into methods so each block is easier to validate and test.');
        }

        if (errors.length === 0 && warnings.length === 0) {
            hints.unshift('No obvious issues were found by heuristic checks.');
        }

        return {
            language: normalizedLanguage,
            mode: 'simulated',
            isValid: errors.length === 0,
            summary: errors.length > 0
                ? 'Simulated validation found potential issues.'
                : 'Simulated validation found no critical issues.',
            errors: errors.slice(0, this.maxDiagnostics),
            warnings: warnings.slice(0, this.maxDiagnostics),
            hints: hints.slice(0, this.maxDiagnostics),
            engine: 'heuristic'
        };
    }

    _checkBracketBalance(code) {
        const stack = [];
        const pairs = {
            ')': '(',
            '}': '{',
            ']': '['
        };
        const openers = new Set(Object.values(pairs));

        for (let i = 0; i < code.length; i++) {
            const char = code[i];

            if (openers.has(char)) {
                stack.push({ char, index: i });
                continue;
            }

            if (pairs[char]) {
                const last = stack.pop();
                if (!last || last.char !== pairs[char]) {
                    return {
                        ok: false,
                        message: `Unmatched '${char}' near character ${i + 1}.`
                    };
                }
            }
        }

        if (stack.length > 0) {
            const unclosed = stack[stack.length - 1];
            return {
                ok: false,
                message: `Unclosed '${unclosed.char}' near character ${unclosed.index + 1}.`
            };
        }

        return { ok: true };
    }

    _withEducationalHints(result, code, language) {
        const enriched = {
            ...result,
            errors: Array.isArray(result.errors) ? [...result.errors] : [],
            warnings: Array.isArray(result.warnings) ? [...result.warnings] : [],
            hints: Array.isArray(result.hints) ? [...result.hints] : []
        };

        const source = String(code || '');
        const normalizedLanguage = this.normalizeLanguage(language) || language;

        if (!enriched.isValid) {
            enriched.hints.unshift('Resolve the first error, then validate again to uncover the next actionable issue.');
        }

        if (normalizedLanguage === 'python') {
            if (!/\bdef\b/.test(source)) {
                enriched.hints.push('Try packaging your logic in functions to make behavior easier to test and reason about.');
            }
            if (!/\bpytest\b|\bunittest\b/.test(source)) {
                enriched.hints.push('After syntax is clean, add at least one small test case for confidence.');
            }
        }

        if (normalizedLanguage === 'csharp') {
            if (!/\bnamespace\b/.test(source)) {
                enriched.hints.push('Consider adding a namespace and organizing types to mimic production structure.');
            }
            if (!/\btry\b/.test(source) && /\bawait\b|\bTask\b/.test(source)) {
                enriched.hints.push('Async snippets benefit from explicit error handling to show failure paths clearly.');
            }
        }

        if (enriched.mode === 'simulated') {
            enriched.hints.push('Real validation becomes available automatically when the required runtime is present.');
        }

        enriched.hints = Array.from(new Set(enriched.hints)).slice(0, this.maxDiagnostics);
        enriched.errors = enriched.errors.slice(0, this.maxDiagnostics);
        enriched.warnings = enriched.warnings.slice(0, this.maxDiagnostics);

        return enriched;
    }

    _runCommand(command, args, options = {}) {
        const timeoutMs = Number(options.timeoutMs) || this.timeoutMs;

        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                cwd: options.cwd,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                try {
                    child.kill();
                } catch (killError) {
                    // Ignore kill errors for already-closed process.
                }
            }, timeoutMs);

            child.stdout.on('data', (chunk) => {
                stdout += String(chunk);
            });

            child.stderr.on('data', (chunk) => {
                stderr += String(chunk);
            });

            child.on('error', (error) => {
                clearTimeout(timeoutHandle);
                reject(error);
            });

            child.on('close', (exitCode) => {
                clearTimeout(timeoutHandle);
                resolve({
                    exitCode,
                    stdout,
                    stderr,
                    timedOut
                });
            });
        });
    }

    _cleanupTempDir(tempDir) {
        if (!tempDir) {
            return;
        }

        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup issues for temporary validation folders.
        }
    }
}

module.exports = CodeValidatorService;
