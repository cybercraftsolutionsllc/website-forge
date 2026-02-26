/**
 * Parser.js — Robust response parsing utilities
 * 
 * Handles XML tag extraction from research output and
 * HTML extraction/cleanup from the developer output.
 */

/**
 * Extracts all XML-tagged values from the AI research response.
 * Returns an object with lowercase keys.
 * 
 * @param {string} text — Raw AI response text
 * @returns {Object} Parsed business data
 */
function extractBusinessData(text) {
    const extract = function (label) {
        // First try exact match
        var regex = new RegExp('<' + label + '>([\\s\\S]*?)<\\/' + label + '>', 'i');
        var match = text.match(regex);
        if (match) return match[1].trim();

        // Fallback: accept truncated closing tags (e.g. </NICH> instead of </NICHE>)
        var fuzzy = new RegExp('<' + label + '>([\\s\\S]*?)<\\/\\w+>', 'i');
        match = text.match(fuzzy);
        return match ? match[1].trim() : '';
    };

    return {
        business_name: extract('NAME'),
        niche: extract('NICHE'),
        slug: extract('SLUG'),
        area: extract('AREA'),
        current_website_url: extract('URL'),
        target_email: extract('EMAIL'),
        target_phone: extract('PHONE'),
        research_notes_summary: extract('NOTES'),
        suggested_domain: extract('DOMAIN'),
        domain_cost: extract('COST'),
        services: extract('SERVICES'),
        email_draft: extract('DRAFT')
    };
}

/**
 * Validates that extracted business data has the minimum required fields.
 * 
 * @param {Object} data — From extractBusinessData()
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateBusinessData(data) {
    var required = ['business_name', 'niche', 'area', 'email_draft'];
    var missing = [];

    for (var i = 0; i < required.length; i++) {
        if (!data[required[i]]) {
            missing.push(required[i]);
        }
    }

    return {
        valid: missing.length === 0,
        missing: missing
    };
}

/**
 * Extracts and cleans HTML from the AI developer response.
 * Handles:
 *   - Markdown code fences (```html ... ```)
 *   - Missing <!DOCTYPE html> prefix
 *   - Extra preamble/explanation text before the HTML
 * 
 * @param {string} text — Raw AI response text
 * @returns {string} Clean HTML string
 */
function extractHTML(text) {
    // Step 1: If wrapped in markdown fences, extract the inner content
    var fenceMatch = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
    if (fenceMatch) {
        text = fenceMatch[1].trim();
    }

    // Step 2: Try to find a full <html>...</html> block
    var htmlMatch = text.match(/<!DOCTYPE\s+html[\s\S]*$/i);
    if (htmlMatch) {
        return htmlMatch[0].trim();
    }

    // Step 3: Try just <html>...</html> without DOCTYPE
    var htmlTagMatch = text.match(/<html[\s\S]*<\/html>/i);
    if (htmlTagMatch) {
        return '<!DOCTYPE html>\n' + htmlTagMatch[0].trim();
    }

    // Step 4: Fallback — assume the whole text is HTML after cleanup
    text = text.replace(/```html/gi, '').replace(/```/g, '').trim();
    if (!text.toLowerCase().startsWith('<!doctype html>')) {
        text = '<!DOCTYPE html>\n' + text;
    }

    return text;
}

/**
 * Quick sanity check that extracted HTML is plausible.
 * 
 * @param {string} html
 * @returns {boolean}
 */
function isValidHTML(html) {
    return html.length > 200 &&
        /<html/i.test(html) &&
        /<\/html>/i.test(html) &&
        /<body/i.test(html);
}

/**
 * Auto-generate a slug from a business name if the AI didn't provide one.
 * 
 * @param {string} name — Business name
 * @returns {string} kebab-case slug
 */
function toSlug(name) {
    return (name || 'unknown-business')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
