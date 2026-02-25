/**
 * Providers.js — Multi-provider LLM abstraction layer
 * 
 * Supports OpenAI, Anthropic, and Gemini APIs.
 * All adapters normalize responses to { text, error }.
 * Includes exponential backoff retry (3 attempts).
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Unified LLM call. Routes to the correct provider.
 * @param {string} prompt — The full prompt text
 * @param {Object} config — From getConfig()
 * @param {Object} [opts] — Optional overrides { temperature, maxTokens, model }
 * @returns {{ text: string, error: string|null }}
 */
function callLLM(prompt, config, opts) {
    opts = opts || {};
    const provider = config.provider;

    switch (provider) {
        case 'openai':
            return callOpenAI(prompt, config, opts);
        case 'anthropic':
            return callAnthropic(prompt, config, opts);
        case 'gemini':
            return callGemini(prompt, config, opts);
        case 'xai':
            return callXAI(prompt, config, opts);
        default:
            return { text: '', error: 'Unknown provider: ' + provider };
    }
}

/**
 * Retry wrapper with exponential backoff.
 */
function withRetry(fn) {
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = fn();
            if (result.error && attempt < MAX_RETRIES) {
                // Retry on API errors (rate limits, server errors)
                lastError = result.error;
                const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`Attempt ${attempt} failed: ${result.error}. Retrying in ${delay}ms...`);
                Utilities.sleep(delay);
                continue;
            }
            return result;
        } catch (e) {
            lastError = e.toString();
            if (attempt < MAX_RETRIES) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`Attempt ${attempt} threw: ${lastError}. Retrying in ${delay}ms...`);
                Utilities.sleep(delay);
            }
        }
    }
    return { text: '', error: 'All retries failed. Last error: ' + lastError };
}

// ============================================================
// OPENAI — Chat Completions API
// ============================================================
function callOpenAI(prompt, config, opts) {
    return withRetry(function () {
        const model = opts.model || config.model;
        const temperature = opts.temperature != null ? opts.temperature : 0.7;
        const maxTokens = opts.maxTokens || 4096;

        const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + config.apiKey,
                'Content-Type': 'application/json'
            },
            payload: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: temperature,
                max_tokens: maxTokens
            }),
            muteHttpExceptions: true
        });

        const code = res.getResponseCode();
        const body = res.getContentText();

        if (code !== 200) {
            console.error('OpenAI API error (' + code + '):', body);
            return { text: '', error: 'OpenAI API returned ' + code + ': ' + body.substring(0, 300) };
        }

        const json = JSON.parse(body);
        const text = json.choices && json.choices[0] && json.choices[0].message
            ? json.choices[0].message.content
            : '';

        if (!text) {
            return { text: '', error: 'OpenAI returned empty content.' };
        }

        return { text: text, error: null };
    });
}

// ============================================================
// ANTHROPIC — Messages API
// ============================================================
function callAnthropic(prompt, config, opts) {
    return withRetry(function () {
        const model = opts.model || config.model;
        const temperature = opts.temperature != null ? opts.temperature : 0.7;
        const maxTokens = opts.maxTokens || 4096;

        const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            },
            payload: JSON.stringify({
                model: model,
                max_tokens: maxTokens,
                messages: [{ role: 'user', content: prompt }],
                temperature: temperature
            }),
            muteHttpExceptions: true
        });

        const code = res.getResponseCode();
        const body = res.getContentText();

        if (code !== 200) {
            console.error('Anthropic API error (' + code + '):', body);
            return { text: '', error: 'Anthropic API returned ' + code + ': ' + body.substring(0, 300) };
        }

        const json = JSON.parse(body);
        const text = json.content && json.content[0] && json.content[0].type === 'text'
            ? json.content[0].text
            : '';

        if (!text) {
            return { text: '', error: 'Anthropic returned empty content.' };
        }

        return { text: text, error: null };
    });
}

// ============================================================
// GEMINI — generateContent API
// ============================================================
function callGemini(prompt, config, opts) {
    return withRetry(function () {
        const model = opts.model || config.model;
        const temperature = opts.temperature != null ? opts.temperature : 0.7;
        const maxTokens = opts.maxTokens || 4096;

        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
            ':generateContent?key=' + config.apiKey;

        const res = UrlFetchApp.fetch(url, {
            method: 'POST',
            contentType: 'application/json',
            payload: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: temperature,
                    maxOutputTokens: maxTokens
                }
            }),
            muteHttpExceptions: true
        });

        const code = res.getResponseCode();
        const body = res.getContentText();

        if (code !== 200) {
            console.error('Gemini API error (' + code + '):', body);
            return { text: '', error: 'Gemini API returned ' + code + ': ' + body.substring(0, 300) };
        }

        const json = JSON.parse(body);
        const text = json.candidates && json.candidates[0] &&
            json.candidates[0].content && json.candidates[0].content.parts &&
            json.candidates[0].content.parts[0]
            ? json.candidates[0].content.parts[0].text
            : '';

        if (!text) {
            return { text: '', error: 'Gemini returned empty content.' };
        }

        return { text: text, error: null };
    });
}

// ============================================================
// XAI — Grok API (OpenAI-compatible)
// ============================================================
function callXAI(prompt, config, opts) {
    return withRetry(function () {
        const model = opts.model || config.model;
        const temperature = opts.temperature != null ? opts.temperature : 0.7;
        const maxTokens = opts.maxTokens || 4096;

        const res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + config.apiKey,
                'Content-Type': 'application/json'
            },
            payload: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: temperature,
                max_tokens: maxTokens
            }),
            muteHttpExceptions: true
        });

        const code = res.getResponseCode();
        const body = res.getContentText();

        if (code !== 200) {
            console.error('xAI API error (' + code + '):', body);
            return { text: '', error: 'xAI API returned ' + code + ': ' + body.substring(0, 300) };
        }

        const json = JSON.parse(body);
        const text = json.choices && json.choices[0] && json.choices[0].message
            ? json.choices[0].message.content
            : '';

        if (!text) {
            return { text: '', error: 'xAI returned empty content.' };
        }

        return { text: text, error: null };
    });
}
