/**
 * Pipeline.js — Main orchestration for WebsiteForge
 * 
 * Three-phase pipeline:
 *   Phase 1: Research — Find a local business with a bad/missing website
 *   Phase 2: Build   — Generate a premium landing page for them
 *   Phase 3: Log     — Deploy to GitHub Pages, log to Google Sheets
 */

// ============================================================
// SHEET HEADERS
// ============================================================
var SHEET_HEADERS = [
    'Date_Run',
    'Area',
    'Business_Name',
    'Slug',
    'Repo_URL',
    'Live_Pages_URL',
    'Suggested_Domain',
    'Domain_Cost_Yearly',
    'Target_Email',
    'Drafted_Email',
    'Status',
    'Sent_Date'
];

/**
 * Ensures the header row exists on the target sheet.
 * Only writes headers if Row 1 is empty or doesn't match.
 */
function ensureHeaders(sheet) {
    var firstRow = sheet.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
    var isEmpty = firstRow.every(function (cell) { return cell === ''; });

    if (isEmpty || firstRow[0] !== SHEET_HEADERS[0]) {
        sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
        sheet.getRange(1, 1, 1, SHEET_HEADERS.length)
            .setFontWeight('bold')
            .setBackground('#1a1a2e')
            .setFontColor('#ffffff');
    }
}

// ============================================================
// PHASE 1: THE RESEARCHER
// ============================================================
function phaseResearch(config) {
    var prompt = [
        'You are an expert lead generation specialist.',
        'Find EXACTLY 1 REAL, highly obscure, small local business in a randomly selected mid-sized US city.',
        'Target niches with terrible/missing websites (mechanics, roofers, dry cleaners, landscapers, plumbers).',
        'No famous places. Hunt for their public contact email address.',
        '',
        'PRICING RULES FOR EMAIL:',
        '- Pitch a flat $199 one-time fee for a single-page site.',
        '- Explicitly state it includes NO ongoing support.',
        '- State extra pages cost more.',
        '- State ongoing support is an extra monthly fee.',
        '- Use the exact literal string "[LIVE_DEMO_URL]" where the website link goes.',
        '',
        'CRITICAL OUTPUT FORMAT:',
        'You MUST output pure text. DO NOT OUTPUT JSON!',
        'Wrap each piece of data in the exact XML tags shown below.',
        'Do not add markdown backticks.',
        '',
        '<NAME>Exact Business Name</NAME>',
        '<NICHE>auto-repair (or roofing, landscaping, etc)</NICHE>',
        '<SLUG>kebab-case-name</SLUG>',
        '<AREA>City, State</AREA>',
        '<URL>http... or None</URL>',
        '<EMAIL>found_email@example.com</EMAIL>',
        '<NOTES>Explain why site is bad/missing</NOTES>',
        '<DOMAIN>Suggested domain</DOMAIN>',
        '<COST>$12.99/year</COST>',
        '<DRAFT>Full cold email body. Include greeting, value proposition, the pricing details above, and a sign-off from CyberCraft Solutions.</DRAFT>'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.7, maxTokens: 2048 });

    if (result.error) {
        return { data: null, error: 'Research API failed: ' + result.error };
    }

    var data = extractBusinessData(result.text);
    var validation = validateBusinessData(data);

    if (!validation.valid) {
        console.error('Research extraction failed. Missing: ' + validation.missing.join(', '));
        console.error('Raw AI output:\n' + result.text);
        return {
            data: null,
            error: 'Could not extract required data. Missing: ' + validation.missing.join(', ') +
                '. The AI may have hallucinated the format. Try again.'
        };
    }

    // Ensure slug exists
    if (!data.slug) {
        data.slug = toSlug(data.business_name);
    }

    return { data: data, error: null };
}

// ============================================================
// PHASE 2: THE DEVELOPER
// ============================================================
function phaseBuild(config, biz) {
    var safeNiche = (biz.niche || 'service').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    var prompt = [
        'You are a world-class UI/UX frontend developer.',
        'Write a stunning, premium $2,000+ custom landing page for a business named "' + biz.business_name + '".',
        'Niche: ' + biz.niche,
        'Location: ' + biz.area,
        '',
        'CRITICAL RULES:',
        '1. TAILWIND V3: Include exactly this in the <head>: <script src="https://cdn.tailwindcss.com"></script>',
        '2. HERO BLUEPRINT: Use this EXACT HTML structure for the Hero section. Use an absolute <img> tag, NOT CSS backgrounds.',
        '   <header class="relative min-h-screen flex items-center justify-center overflow-hidden">',
        '     <img src="https://image.pollinations.ai/prompt/' + safeNiche + '-professional-service?width=1920&height=1080&nologo=true" alt="Background" class="absolute inset-0 w-full h-full object-cover z-0" onerror="this.onerror=null;this.src=\'https://picsum.photos/1920/1080?blur=2\';" />',
        '     <div class="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/60 to-slate-900/90 z-10"></div>',
        '     <div class="relative z-20 text-center container mx-auto px-6 flex flex-col items-center justify-center mt-16">',
        '       <h1 class="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-tight max-w-4xl drop-shadow-2xl">' + biz.business_name + '</h1>',
        '       <p class="text-xl md:text-2xl text-slate-200 mb-10 max-w-2xl drop-shadow-md">Premium ' + biz.niche + ' services in ' + biz.area + '</p>',
        '       <a href="#contact" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-10 rounded-full text-lg transition-transform hover:scale-105 shadow-2xl">Get a Free Quote</a>',
        '     </div>',
        '   </header>',
        '3. BRANDING: The navbar MUST display "' + biz.business_name + '". Use a sticky glassmorphism navbar (fixed top-0 w-full backdrop-blur-md bg-white/95 z-50 text-slate-900 shadow-sm py-4).',
        '4. SECTIONS: Include Services, About, Testimonials, and Contact sections. The Contact section AND footer MUST use bg-slate-900 text-white.',
        '5. IMAGES: Use "https://image.pollinations.ai/prompt/' + safeNiche + '-work-professional?width=1080&height=720&nologo=true" for all other images.',
        '6. FOOTER: Include "Powered by CyberCraft Solutions" in a small footer note.',
        '',
        'Return ONLY the raw HTML code starting with <!DOCTYPE html>.',
        'Do NOT wrap it in markdown backticks. Do NOT output any JSON or explanation.'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.5, maxTokens: 8192 });

    if (result.error) {
        return { html: '', error: 'Build API failed: ' + result.error };
    }

    var html = extractHTML(result.text);

    if (!isValidHTML(html)) {
        console.error('HTML validation failed. Extracted content length: ' + html.length);
        console.error('First 500 chars:\n' + html.substring(0, 500));
        return { html: '', error: 'Generated HTML failed validation. The AI may not have returned proper HTML. Try again.' };
    }

    return { html: html, error: null };
}

// ============================================================
// PHASE 3: LOG & DEPLOY
// ============================================================
function phaseLog(config, biz, html) {
    var ss = SpreadsheetApp.openById(config.sheetId);
    var sheet = ss.getSheetByName('Sheet1');

    if (!sheet) {
        sheet = ss.insertSheet('Sheet1');
    }

    ensureHeaders(sheet);

    var slug = biz.slug || toSlug(biz.business_name);
    var today = new Date().toISOString().split('T')[0];
    var repoUrl = 'https://github.com/' + config.org + '/' + config.repo;

    // Deploy to GitHub Pages
    var deploy = deployToGitHubPages(slug, html, config);

    if (!deploy.success) {
        return { error: 'GitHub deploy failed: ' + deploy.error };
    }

    var liveUrl = deploy.liveUrl;

    // Finalize the email draft with the live URL
    var email = biz.email_draft || '';
    if (email.indexOf('[LIVE_DEMO_URL]') !== -1) {
        email = email.replace(/\[LIVE_DEMO_URL\]/g, liveUrl);
    } else {
        // Fallback: try to replace any placeholder-like bracket text
        email = email.replace(/\[.*?demo.*?\]|\[.*?link.*?\]/gi, liveUrl);
        if (email.indexOf(liveUrl) === -1) {
            email += '\n\nView your live demo site here: ' + liveUrl;
        }
    }

    // Append row to sheet
    sheet.appendRow([
        today,                        // Date_Run
        biz.area || '',               // Area
        biz.business_name || '',      // Business_Name
        slug,                         // Slug
        repoUrl,                      // Repo_URL
        liveUrl,                      // Live_Pages_URL
        biz.suggested_domain || '',   // Suggested_Domain
        biz.domain_cost || '',        // Domain_Cost_Yearly
        biz.target_email || '',       // Target_Email
        email,                        // Drafted_Email
        'Review Needed',              // Status
        ''                            // Sent_Date
    ]);

    return { error: null, liveUrl: liveUrl };
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
function runWebsiteForgePipeline() {
    var config = getConfig();
    if (!config) return;

    var ss = SpreadsheetApp.openById(config.sheetId);

    // --- Phase 1: Research ---
    ss.toast('Phase 1: Researcher Agent scanning for leads...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var research = phaseResearch(config);
    if (research.error) {
        ss.toast(research.error, '❌ Phase 1 Failed', 10);
        console.error('Phase 1 Error:', research.error);
        return;
    }

    var biz = research.data;
    console.log('Phase 1 complete. Target: ' + biz.business_name + ' in ' + biz.area);

    // --- Phase 2: Build ---
    ss.toast('Phase 2: Target found: ' + biz.business_name + '. Generating landing page...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var build = phaseBuild(config, biz);
    if (build.error) {
        ss.toast(build.error, '❌ Phase 2 Failed', 10);
        console.error('Phase 2 Error:', build.error);
        return;
    }

    console.log('Phase 2 complete. HTML generated (' + build.html.length + ' chars).');

    // --- Phase 3: Deploy & Log ---
    ss.toast('Phase 3: Deploying to GitHub Pages & logging to sheet...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var log = phaseLog(config, biz, build.html);
    if (log.error) {
        ss.toast(log.error, '❌ Phase 3 Failed', 10);
        console.error('Phase 3 Error:', log.error);
        return;
    }

    ss.toast(
        '✅ Pipeline complete! ' + biz.business_name + ' — ' + log.liveUrl,
        '🎉 WebsiteForge',
        15
    );
}

// ============================================================
// MENU
// ============================================================
function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu('🚀 WebsiteForge')
        .addItem('Generate 1 Lead', 'runWebsiteForgePipeline')
        .addToUi();
}
