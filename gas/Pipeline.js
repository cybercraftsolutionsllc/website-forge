/**
 * Pipeline.js — Main orchestration for WebsiteForge
 * 
 * Four-phase pipeline:
 *   Phase 1: Research — Find a local business (SKIPS if no verified email found)
 *   Phase 2: Build   — Generate a premium landing page with contextual images
 *   Phase 3: Deploy  — Push to GitHub Pages, log to Google Sheets
 *   Phase 4: Email   — Send professional HTML email via Gmail (if enabled)
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
    var paymentLine = config.paymentLink
        ? '- Include the exact literal string "[PAYMENT_LINK]" as a clickable link in the email where the customer can pay instantly.'
        : '';

    var prompt = [
        'You are an expert lead generation specialist.',
        'Find EXACTLY 1 REAL, highly obscure, small local business in a randomly selected mid-sized US city.',
        'Target niches with terrible/missing websites (mechanics, roofers, dry cleaners, landscapers, plumbers).',
        'No famous places.',
        '',
        'EMAIL ADDRESS — CRITICAL RULES:',
        'You MUST find a VERIFIED, REAL email address that is publicly associated with this specific business.',
        'Acceptable sources: their website contact page, Google Business listing, Yelp page, Facebook page, BBB listing, or official social media.',
        'The email MUST clearly belong to this business (e.g., contains the business name, or is listed on their official pages).',
        'Generic emails like info@gmail.com, admin@example.com, or emails you are not 100% sure about are NOT acceptable.',
        'If you CANNOT find a verified email that is clearly associated with the business, you MUST put exactly "No email found" in the EMAIL tag.',
        'Do NOT guess or fabricate email addresses. Accuracy is more important than finding a lead.',
        '',
        'PRICING RULES FOR EMAIL:',
        '- Pitch a flat $199 one-time fee for a single-page site.',
        '- Explicitly state it includes NO ongoing support.',
        '- State extra pages cost more.',
        '- State ongoing support is an extra monthly fee.',
        '- Use the exact literal string "[LIVE_DEMO_URL]" where the website demo link goes.',
        paymentLine,
        '',
        'DISCLAIMER — MUST INCLUDE IN THE EMAIL DRAFT:',
        'The email MUST contain this notice near the end (before the sign-off):',
        '"Please note: We will reach out for additional information to ensure your website is 100% accurate before finalizing. If we do not hear back, we will proceed using the best publicly available information and cannot be held responsible for any inaccuracies."',
        '',
        'ALSO PROVIDE A LIST OF SERVICES:',
        'List 4-6 specific services this type of business would typically offer.',
        'These must be real, specific services — NOT generic. For example:',
        '  Auto repair → "Brake Repair", "Engine Diagnostics", "Oil Changes", "Transmission Repair", "AC Repair", "Tire Services"',
        '  Roofing → "Roof Replacement", "Leak Repair", "Gutter Installation", "Storm Damage Repair", "Roof Inspections"',
        '  Landscaping → "Lawn Maintenance", "Tree Trimming", "Patio Design", "Irrigation Systems", "Mulching"',
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
        '<EMAIL>verified_email@business.com OR "No email found"</EMAIL>',
        '<NOTES>Explain why site is bad/missing</NOTES>',
        '<DOMAIN>Suggested domain</DOMAIN>',
        '<COST>$12.99/year</COST>',
        '<SERVICES>Brake Repair, Engine Diagnostics, Oil Changes, Transmission Repair, AC Repair, Tire Services</SERVICES>',
        '<DRAFT>Full cold email body. Must include greeting, value proposition, pricing details, the disclaimer above, and a professional sign-off from CyberCraft Solutions.</DRAFT>'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.7, maxTokens: 3000 });

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

    // --- EMAIL GATE: Skip leads with no verified email ---
    var emailLower = (data.target_email || '').toLowerCase().trim();
    if (!emailLower ||
        emailLower === 'no email found' ||
        emailLower === 'none' ||
        emailLower === 'n/a' ||
        emailLower === 'unknown' ||
        emailLower.indexOf('@') === -1) {
        console.log('No verified email found for ' + data.business_name + '. Skipping this lead.');
        return {
            data: null,
            error: 'No verified email found for "' + data.business_name + '". Lead skipped — run again for a new lead.'
        };
    }

    // Ensure slug exists
    if (!data.slug) {
        data.slug = toSlug(data.business_name);
    }

    return { data: data, error: null };
}

// ============================================================
// PHASE 2: THE DEVELOPER (Contextual Images)
// ============================================================
function phaseBuild(config, biz) {
    var safeNiche = (biz.niche || 'service').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Parse the services list from research
    var servicesList = (biz.services || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (servicesList.length === 0) {
        servicesList = ['General Service', 'Consultation', 'Repair', 'Maintenance'];
    }

    // Build VERY specific per-service image instructions
    var serviceImageRules = servicesList.map(function (svc, idx) {
        var svcSlug = svc.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        // Each image gets a highly specific contextual description
        return '     Service ' + (idx + 1) + ': "' + svc + '"' +
            '\n       → Image: https://image.pollinations.ai/prompt/realistic-photograph-of-' + svcSlug +
            '-being-performed-by-professional-worker-in-' + safeNiche + '-shop?width=800&height=600&nologo=true' +
            '\n       → The image MUST visually depict "' + svc + '" specifically — show the actual work, tools, or result.';
    }).join('\n');

    var prompt = [
        'You are a world-class UI/UX frontend developer.',
        'Write a stunning, premium $2,000+ custom landing page for a business named "' + biz.business_name + '".',
        'Niche: ' + biz.niche,
        'Location: ' + biz.area,
        'Services offered: ' + servicesList.join(', '),
        '',
        'CRITICAL RULES:',
        '',
        '1. TAILWIND V3: Include exactly this in the <head>: <script src="https://cdn.tailwindcss.com"></script>',
        '',
        '2. HERO SECTION: Full-screen hero with a background image showing a real ' + safeNiche + ' shop exterior or workspace.',
        '   <header class="relative min-h-screen flex items-center justify-center overflow-hidden">',
        '     <img src="https://image.pollinations.ai/prompt/realistic-photograph-of-' + safeNiche + '-business-storefront-exterior-daytime-professional-photography?width=1920&height=1080&nologo=true" alt="' + biz.business_name + '" class="absolute inset-0 w-full h-full object-cover z-0" onerror="this.onerror=null;this.src=\'https://picsum.photos/1920/1080?blur=2\';" />',
        '     <div class="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/60 to-slate-900/90 z-10"></div>',
        '     <div class="relative z-20 text-center container mx-auto px-6 flex flex-col items-center justify-center mt-16">',
        '       <h1 class="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-tight max-w-4xl drop-shadow-2xl">' + biz.business_name + '</h1>',
        '       <p class="text-xl md:text-2xl text-slate-200 mb-10 max-w-2xl drop-shadow-md">Premium ' + biz.niche + ' services in ' + biz.area + '</p>',
        '       <a href="#contact" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-10 rounded-full text-lg transition-transform hover:scale-105 shadow-2xl">Get a Free Quote</a>',
        '     </div>',
        '   </header>',
        '',
        '3. NAVBAR: Sticky glassmorphism navbar displaying "' + biz.business_name + '" (fixed top-0 w-full backdrop-blur-md bg-white/95 z-50 text-slate-900 shadow-sm py-4).',
        '',
        '4. SERVICE CARDS — EACH CARD MUST HAVE A CONTEXTUALLY ACCURATE IMAGE:',
        '   Create a card for EACH service. Every card gets a UNIQUE Pollinations image that MATCHES the specific service being described.',
        '   The image must visually represent what the service IS — not a generic photo.',
        '   Use this Pollinations URL pattern: https://image.pollinations.ai/prompt/realistic-photograph-of-{specific-service-action}?width=800&height=600&nologo=true',
        '',
        '   EXACT IMAGE URLS TO USE:',
        serviceImageRules,
        '',
        '   Add onerror="this.onerror=null;this.src=\'https://picsum.photos/800/600\';" to every <img>.',
        '   Each card: rounded image on top, service name (bold), 2-line description, "Get Quote" button.',
        '',
        '5. ABOUT SECTION: Warm, personal copy. Include an image of the team/workspace:',
        '   src="https://image.pollinations.ai/prompt/realistic-photograph-of-friendly-' + safeNiche + '-workers-team-in-workshop-smiling-professional?width=1080&height=720&nologo=true"',
        '',
        '6. TESTIMONIALS: 3 realistic testimonials. Use star icons (★). NO photos — only name, stars, and quote text on clean cards.',
        '',
        '7. CONTACT & FOOTER: bg-slate-900 text-white. Contact form with name, email, phone, message fields. Footer with address and "Powered by CyberCraft Solutions".',
        '',
        'Return ONLY the raw HTML starting with <!DOCTYPE html>. No markdown fences. No explanation.'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.5, maxTokens: 8192 });

    if (result.error) {
        return { html: '', error: 'Build API failed: ' + result.error };
    }

    var html = extractHTML(result.text);

    if (!isValidHTML(html)) {
        console.error('HTML validation failed. Extracted content length: ' + html.length);
        console.error('First 500 chars:\n' + html.substring(0, 500));
        return { html: '', error: 'Generated HTML failed validation. Try again.' };
    }

    return { html: html, error: null };
}

// ============================================================
// PHASE 3: DEPLOY & LOG
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

    // Build the professional HTML email
    var emailHtml = buildProfessionalEmail(config, biz, liveUrl);

    // Also keep a plain-text version for the sheet (readable)
    var emailPlain = buildPlainTextEmail(config, biz, liveUrl);

    // Append row to sheet (store the plain-text version for readability)
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
        emailPlain,                   // Drafted_Email (plain text for sheet readability)
        'Review Needed',              // Status
        ''                            // Sent_Date
    ]);

    var lastRow = sheet.getLastRow();
    return { error: null, liveUrl: liveUrl, emailHtml: emailHtml, emailPlain: emailPlain, rowNumber: lastRow };
}

// ============================================================
// PROFESSIONAL EMAIL BUILDER
// ============================================================

/**
 * Builds a professional HTML email from the AI-drafted content.
 */
function buildProfessionalEmail(config, biz, liveUrl) {
    var paymentButton = '';
    if (config.paymentLink) {
        paymentButton = '<tr><td style="padding:20px 0 0 0;text-align:center">' +
            '<a href="' + config.paymentLink + '" style="display:inline-block;background:#059669;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">Pay $199 &amp; Get Started →</a>' +
            '</td></tr>';
    }

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
        '<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07)">' +

        // Header bar
        '<tr><td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:30px 40px;text-align:center">' +
        '<h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">CyberCraft Solutions</h1>' +
        '<p style="margin:6px 0 0;color:#93c5fd;font-size:13px">Professional Web Design &amp; Development</p>' +
        '</td></tr>' +

        // Body
        '<tr><td style="padding:36px 40px">' +

        // Greeting
        '<p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.6">Hi ' + (biz.business_name || 'there') + ' team,</p>' +

        '<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7">' +
        'I came across <strong>' + biz.business_name + '</strong> while researching ' + (biz.niche || 'local businesses') +
        ' in ' + (biz.area || 'your area') + ', and I noticed your online presence could use an upgrade. ' +
        'So I went ahead and built you a <strong>free custom website demo</strong> — no strings attached.</p>' +

        // Demo CTA
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
        '<tr><td style="padding:20px 0;text-align:center">' +
        '<a href="' + liveUrl + '" style="display:inline-block;background:#2563eb;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">View Your Free Demo →</a>' +
        '</td></tr></table>' +

        // Pricing
        '<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7">' +
        'If you like what you see, I can make it yours for a simple <strong>one-time fee of $199</strong>. Here\'s what that includes:</p>' +

        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0">' +
        '<tr><td style="padding:4px 10px 4px 0;color:#059669;font-size:18px;vertical-align:top">✓</td><td style="padding:4px 0;color:#374151;font-size:14px">Fully custom single-page website, tailored to your business</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#059669;font-size:18px;vertical-align:top">✓</td><td style="padding:4px 0;color:#374151;font-size:14px">Mobile-responsive design that looks great on all devices</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#059669;font-size:18px;vertical-align:top">✓</td><td style="padding:4px 0;color:#374151;font-size:14px">Professional, modern aesthetics for your brand</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#6b7280;font-size:18px;vertical-align:top">•</td><td style="padding:4px 0;color:#6b7280;font-size:14px">Additional pages available at extra cost</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#6b7280;font-size:18px;vertical-align:top">•</td><td style="padding:4px 0;color:#6b7280;font-size:14px">Ongoing maintenance &amp; support available as a monthly add-on</td></tr>' +
        '</table>' +

        // Payment button
        paymentButton +

        // Disclaimer
        '<div style="margin:24px 0;padding:16px 20px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px">' +
        '<p style="margin:0;color:#92400e;font-size:13px;line-height:1.6">' +
        '<strong>Please note:</strong> We will reach out for additional information to ensure your website is 100% accurate before finalizing. ' +
        'If we do not hear back, we will proceed using the best publicly available information and cannot be held responsible for any inaccuracies.' +
        '</p></div>' +

        // Sign-off
        '<p style="margin:20px 0 0;color:#374151;font-size:15px;line-height:1.7">' +
        'Looking forward to helping ' + biz.business_name + ' stand out online!</p>' +

        '<p style="margin:16px 0 0;color:#1f2937;font-size:15px;font-weight:600">Best regards,</p>' +
        '<p style="margin:4px 0 0;color:#1f2937;font-size:15px">' + config.senderName + '</p>' +
        '<p style="margin:2px 0 0;color:#6b7280;font-size:13px">CyberCraft Solutions</p>' +

        '</td></tr>' +

        // Footer
        '<tr><td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb">' +
        '<p style="margin:0;color:#9ca3af;font-size:11px">CyberCraft Solutions · Professional Web Design</p>' +
        '</td></tr>' +

        '</table></td></tr></table></body></html>';
}

/**
 * Builds a clean plain-text version of the email (stored in the sheet for readability).
 */
function buildPlainTextEmail(config, biz, liveUrl) {
    var lines = [
        'Hi ' + (biz.business_name || 'there') + ' team,',
        '',
        'I came across ' + biz.business_name + ' while researching ' + (biz.niche || 'local businesses') +
        ' in ' + (biz.area || 'your area') + ', and I noticed your online presence could use an upgrade.',
        'So I went ahead and built you a free custom website demo — no strings attached.',
        '',
        '🔗 View your demo: ' + liveUrl,
        '',
        'If you like what you see, the site is yours for a one-time fee of $199.',
        '',
        'What\'s included:',
        '  ✓ Fully custom single-page website',
        '  ✓ Mobile-responsive design',
        '  ✓ Professional, modern aesthetics',
        '  • Additional pages available at extra cost',
        '  • Ongoing maintenance & support as a monthly add-on',
        ''
    ];

    if (config.paymentLink) {
        lines.push('Ready to get started? Pay securely here: ' + config.paymentLink);
        lines.push('');
    }

    lines.push(
        '---',
        'Please note: We will reach out for additional information to ensure your website is 100% accurate before finalizing. If we do not hear back, we will proceed using the best publicly available information and cannot be held responsible for any inaccuracies.',
        '---',
        '',
        'Looking forward to helping ' + biz.business_name + ' stand out online!',
        '',
        'Best regards,',
        config.senderName,
        'CyberCraft Solutions'
    );

    return lines.join('\n');
}

// ============================================================
// PHASE 4: EMAIL
// ============================================================

/**
 * Sends a professional HTML email via GmailApp.
 */
function sendEmail(targetEmail, subject, htmlBody, plainBody, senderName) {
    try {
        GmailApp.sendEmail(targetEmail, subject, plainBody, {
            name: senderName,
            htmlBody: htmlBody
        });
        return { success: true, error: null };
    } catch (e) {
        console.error('GmailApp.sendEmail failed:', e);
        return { success: false, error: e.toString() };
    }
}

/**
 * Phase 4: Optionally auto-send the email and update the sheet row.
 */
function phaseEmail(config, biz, emailHtml, emailPlain, rowNumber) {
    if (!config.autoSendEmail) {
        console.log('AUTO_SEND_EMAIL is off. Email saved for review.');
        return { sent: false, error: null };
    }

    if (!biz.target_email) {
        console.log('No target email found. Skipping send.');
        return { sent: false, error: 'No target email address found.' };
    }

    var subject = 'I built ' + biz.business_name + ' a free website';
    var result = sendEmail(biz.target_email, subject, emailHtml, emailPlain, config.senderName);

    if (result.success) {
        var ss = SpreadsheetApp.openById(config.sheetId);
        var sheet = ss.getSheetByName('Sheet1');
        var statusCol = SHEET_HEADERS.indexOf('Status') + 1;
        var sentDateCol = SHEET_HEADERS.indexOf('Sent_Date') + 1;
        var now = new Date().toISOString();

        sheet.getRange(rowNumber, statusCol).setValue('Sent');
        sheet.getRange(rowNumber, sentDateCol).setValue(now);

        return { sent: true, error: null };
    }

    return { sent: false, error: result.error };
}

// ============================================================
// BATCH SEND: Send all pending emails
// ============================================================
function sendAllPendingEmails() {
    var config = getConfig();
    if (!config) return;

    var ss = SpreadsheetApp.openById(config.sheetId);
    var sheet = ss.getSheetByName('Sheet1');

    if (!sheet) {
        ss.toast('No Sheet1 found.', '❌ Error', 5);
        return;
    }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var statusCol = headers.indexOf('Status');
    var emailCol = headers.indexOf('Drafted_Email');
    var targetEmailCol = headers.indexOf('Target_Email');
    var businessNameCol = headers.indexOf('Business_Name');
    var liveUrlCol = headers.indexOf('Live_Pages_URL');
    var nicheCol = headers.indexOf('Business_Name'); // fallback
    var areaCol = headers.indexOf('Area');
    var sentDateCol = headers.indexOf('Sent_Date');

    if (statusCol === -1 || emailCol === -1 || targetEmailCol === -1) {
        ss.toast('Sheet headers are missing required columns.', '❌ Error', 5);
        return;
    }

    var sentCount = 0;
    var skipCount = 0;
    var failCount = 0;

    for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (row[statusCol] !== 'Review Needed') {
            skipCount++;
            continue;
        }

        var targetEmail = row[targetEmailCol];
        var businessName = row[businessNameCol] || 'your business';
        var liveUrl = row[liveUrlCol] || '';
        var area = row[areaCol] || '';

        if (!targetEmail || targetEmail.toLowerCase().indexOf('@') === -1) {
            skipCount++;
            continue;
        }

        // Build HTML email for batch send too
        var fakeBiz = {
            business_name: businessName,
            niche: 'local services',
            area: area,
            target_email: targetEmail
        };
        var htmlEmail = buildProfessionalEmail(config, fakeBiz, liveUrl);
        var plainEmail = row[emailCol] || buildPlainTextEmail(config, fakeBiz, liveUrl);

        var subject = 'I built ' + businessName + ' a free website';
        var result = sendEmail(targetEmail, subject, htmlEmail, plainEmail, config.senderName);

        if (result.success) {
            var sheetRow = i + 1;
            sheet.getRange(sheetRow, statusCol + 1).setValue('Sent');
            sheet.getRange(sheetRow, sentDateCol + 1).setValue(new Date().toISOString());
            sentCount++;
        } else {
            failCount++;
            console.error('Failed to send to ' + targetEmail + ': ' + result.error);
        }

        // Rate limit: 2s between emails
        Utilities.sleep(2000);
    }

    ss.toast(
        '✅ Sent: ' + sentCount + ' | Skipped: ' + skipCount + ' | Failed: ' + failCount,
        '📧 Batch Send Complete',
        10
    );
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
        ss.toast(research.error, '❌ Phase 1', 10);
        console.error('Phase 1 Error:', research.error);
        return;
    }

    var biz = research.data;
    console.log('Phase 1 complete. Target: ' + biz.business_name + ' (' + biz.target_email + ')');

    // --- Phase 2: Build ---
    ss.toast('Phase 2: Building website for ' + biz.business_name + '...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var build = phaseBuild(config, biz);
    if (build.error) {
        ss.toast(build.error, '❌ Phase 2', 10);
        console.error('Phase 2 Error:', build.error);
        return;
    }

    console.log('Phase 2 complete. HTML: ' + build.html.length + ' chars.');

    // --- Phase 3: Deploy & Log ---
    ss.toast('Phase 3: Deploying & logging...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var log = phaseLog(config, biz, build.html);
    if (log.error) {
        ss.toast(log.error, '❌ Phase 3', 10);
        console.error('Phase 3 Error:', log.error);
        return;
    }

    // --- Phase 4: Email ---
    if (config.autoSendEmail && biz.target_email) {
        ss.toast('Phase 4: Sending to ' + biz.target_email + '...', '🚀 WebsiteForge', -1);
        SpreadsheetApp.flush();

        var emailResult = phaseEmail(config, biz, log.emailHtml, log.emailPlain, log.rowNumber);
        if (emailResult.sent) {
            ss.toast('✅ Done! Email sent to ' + biz.target_email, '🎉 WebsiteForge', 15);
        } else if (emailResult.error) {
            ss.toast('⚠️ Deployed but email failed: ' + emailResult.error, '⚠️ WebsiteForge', 15);
        }
    } else {
        ss.toast('✅ Done! ' + biz.business_name + ' — review email in sheet', '🎉 WebsiteForge', 15);
    }
}

// ============================================================
// MENU
// ============================================================
function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu('🚀 WebsiteForge')
        .addItem('Generate 1 Lead', 'runWebsiteForgePipeline')
        .addSeparator()
        .addItem('📧 Send All Pending Emails', 'sendAllPendingEmails')
        .addToUi();
}
