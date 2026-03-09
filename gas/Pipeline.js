/**
 * Pipeline.js — Main orchestration for WebsiteForge
 * 
 * Four-phase pipeline:
 *   Phase 1: Discover — Find verified leads via Google Places API, then LLM for copy
 *   Phase 2: Build    — Generate a premium landing page with contextual images
 *   Phase 3: Deploy   — Push to GitHub Pages, log to Google Sheets
 *   Phase 4: Outreach — Send via Gmail (email) or Twilio (SMS), or save for review
 */

// ============================================================
// SHEET HEADERS
// ============================================================
var SHEET_HEADERS = [
    'Date_Run',
    'Area',
    'Niche',
    'Business_Name',
    'Slug',
    'Repo_URL',
    'Live_Pages_URL',
    'Suggested_Domain',
    'Domain_Cost_Yearly',
    'Target_Email',
    'Target_Phone',
    'Drafted_Message',
    'Channel',
    'Status',
    'Sent_Date',
    'Place_ID'
];

/**
 * Ensures the header row matches SHEET_HEADERS exactly.
 * Detects stale headers (wrong count, wrong column names) and overwrites them.
 */
function ensureHeaders(sheet) {
    var lastCol = sheet.getLastColumn() || 1;
    var readCols = Math.max(lastCol, SHEET_HEADERS.length);
    var firstRow = sheet.getRange(1, 1, 1, readCols).getValues()[0];
    var isEmpty = firstRow.every(function (cell) { return cell === ''; });

    // Check if headers match exactly
    var headersMatch = !isEmpty && firstRow.length >= SHEET_HEADERS.length;
    if (headersMatch) {
        for (var i = 0; i < SHEET_HEADERS.length; i++) {
            if (firstRow[i] !== SHEET_HEADERS[i]) {
                headersMatch = false;
                break;
            }
        }
    }

    if (!headersMatch) {
        console.log('Headers stale or missing — rewriting ' + SHEET_HEADERS.length + ' columns');
        sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
        sheet.getRange(1, 1, 1, SHEET_HEADERS.length)
            .setFontWeight('bold')
            .setBackground('#1a1a2e')
            .setFontColor('#ffffff');
    }
}

// ============================================================
// CONTACT HELPERS
// ============================================================

/**
 * Check if email looks valid.
 */
function isValidEmail(email) {
    if (!email) return false;
    var lower = email.toLowerCase().trim();
    if (lower === 'no email found' || lower === 'none' || lower === 'n/a' || lower === 'unknown') return false;
    return lower.indexOf('@') !== -1;
}

/**
 * Check if phone looks valid (has at least 10 digits).
 */
function isValidPhone(phone) {
    if (!phone) return false;
    var lower = phone.toLowerCase().trim();
    if (lower === 'no phone found' || lower === 'none' || lower === 'n/a' || lower === 'unknown') return false;
    var digits = phone.replace(/[^0-9]/g, '');
    return digits.length >= 10;
}

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX).
 */
function normalizePhone(phone) {
    var digits = phone.replace(/[^0-9]/g, '');
    if (digits.length === 10) digits = '1' + digits;
    return '+' + digits;
}

// phaseResearch() has been removed.
// Lead discovery is now handled by findLeadFromPlaces() + generateCopyForLead()
// in Places.js. The LLM NEVER generates business names, phones, or addresses.

// ============================================================
// PHASE 2: THE DEVELOPER (LLM-driven image selection)
// ============================================================

function phaseBuild(config, biz) {
    var niche = (biz.niche || 'service').replace(/-/g, ' ');
    var area = biz.area || '';

    var servicesList = (biz.services || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (servicesList.length === 0) {
        servicesList = ['General Service', 'Consultation', 'Repair', 'Maintenance'];
    }

    var prompt = [
        'You are a world-class frontend developer. Build a premium landing page.',
        '',
        'Business: "' + biz.business_name + '"',
        'Niche: ' + niche,
        'Location: ' + area,
        'Services: ' + servicesList.join(', '),
        '',
        'RULES:',
        '1. Include <script src="https://cdn.tailwindcss.com"></script> in <head>.',
        '',
        '2. IMAGES — THIS IS CRITICAL:',
        '   Every <img> MUST use loremflickr.com with keyword-based URLs.',
        '   Format: https://loremflickr.com/WIDTH/HEIGHT/keyword1,keyword2',
        '   To make each image unique, append /all?lock=NUMBER with a different number for each image.',
        '   Example: https://loremflickr.com/800/600/plumbing,pipe/all?lock=1',
        '   Pick 2-3 simple, broad keywords that describe what the image should show.',
        '   Use common English words — avoid compound phrases.',
        '   HERO image: https://loremflickr.com/1920/1080/' + niche.replace(/\s+/g, ',') + ',business/all?lock=0',
        '   Each service card: use keywords specific to THAT service + the niche.',
        '     Example for "Drain Cleaning" in plumbing: https://loremflickr.com/800/600/plumbing,pipe,drain/all?lock=1',
        '     Example for "Oil Change" in auto repair: https://loremflickr.com/800/600/mechanic,oil,car/all?lock=2',
        '   About section: https://loremflickr.com/800/600/worker,team,' + niche.split(' ')[0] + '/all?lock=99',
        '   DO NOT reuse the same lock number. Each image must be unique.',
        '   Add onerror="this.onerror=null;this.src=\'https://picsum.photos/800/600\';" to every <img>.',
        '',
        '3. HERO: Full-screen hero with background <img>. Dark gradient overlay.',
        '   Big white heading "' + biz.business_name + '". Subtitle about ' + niche + ' in ' + area + '. CTA button.',
        '',
        '4. NAVBAR: Sticky glassmorphism with "' + biz.business_name + '" text.',
        '',
        '5. SERVICES: Grid of cards — one for each: ' + servicesList.join(', ') + '.',
        '   Each card: contextual <img> (using loremflickr keywords for that service), service name, 2-line description.',
        '   DO NOT put a "Get Quote" or CTA button on each individual card — keep cards clean.',
        '   Instead, add ONE single centered CTA button BELOW the entire services grid that says "Get Your Free Quote" and links to #contact.',
        '',
        '6. ABOUT: Section with team <img> and warm paragraph about the business.',
        '',
        '7. TESTIMONIALS: 3 text-only testimonials with star ratings (no images).',
        '',
        '8. CONTACT + FOOTER: bg-slate-900 text-white. Form (name, email, phone, message). "Powered by Cyber Craft Solutions".',
        '',
        'Return ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No explanation.'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.5, maxTokens: 8192 });

    if (result.error) {
        return { html: '', error: 'Build API failed: ' + result.error };
    }

    var html = extractHTML(result.text);

    if (!isValidHTML(html)) {
        console.error('HTML validation failed. Length: ' + html.length);
        return { html: '', error: 'Generated HTML failed validation. Try again.' };
    }

    // Server-side: check each loremflickr URL and swap defaults with picsum
    html = html.replace(/(https:\/\/loremflickr\.com\/[^"'\s]+)/gi, function (url) {
        try {
            // Don't follow redirects — we need to see WHERE it redirects to
            var res = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true });
            var code = res.getResponseCode();
            var location = '';
            try { location = res.getHeaders()['Location'] || ''; } catch (e2) { }
            if (!location) try { location = res.getHeaders()['location'] || ''; } catch (e3) { }

            // LoremFlickr redirects to the actual image URL — check if it's the default
            var isDefault = (location.indexOf('defaultImage') > -1) ||
                (code >= 400) ||
                (code === 200 && res.getContentText().substring(0, 500).indexOf('defaultImage') > -1);

            if (isDefault) {
                var dims = url.match(/loremflickr\.com\/(\d+)\/(\d+)/);
                var w = dims ? dims[1] : '800';
                var h = dims ? dims[2] : '600';
                var seed = Math.floor(Math.random() * 10000);
                console.log('Swapped default loremflickr → picsum (seed ' + seed + ')');
                return 'https://picsum.photos/seed/' + seed + '/' + w + '/' + h;
            }
        } catch (e) {
            var dims2 = url.match(/loremflickr\.com\/(\d+)\/(\d+)/);
            var w2 = dims2 ? dims2[1] : '800';
            var h2 = dims2 ? dims2[2] : '600';
            return 'https://picsum.photos/seed/' + Math.floor(Math.random() * 10000) + '/' + w2 + '/' + h2;
        }
        return url;
    });

    return { html: html, error: null };
}

// ============================================================
// PHASE 3: DEPLOY & LOG
// ============================================================
function phaseLog(config, biz, html) {
    var ss = SpreadsheetApp.openById(config.sheetId);
    var sheet = ss.getSheetByName('Leads');

    if (!sheet) {
        sheet = ss.insertSheet('Leads');
    }

    ensureHeaders(sheet);

    var slug = biz.slug || toSlug(biz.business_name);
    var today = new Date().toISOString().split('T')[0];
    var repoUrl = 'https://github.com/' + config.org + '/' + config.repo;

    var deploy = deployToGitHubPages(slug, html, config);

    if (!deploy.success) {
        return { error: 'GitHub deploy failed: ' + deploy.error };
    }

    var liveUrl = deploy.liveUrl;

    // Build messages
    var emailHtml, plainText, smsText;
    try {
        emailHtml = buildProfessionalEmail(config, biz, liveUrl);
        plainText = buildPlainTextMessage(config, biz, liveUrl);
        smsText = buildSmsMessage(config, biz, liveUrl);
    } catch (e) {
        console.error('Message builder error:', e);
        emailHtml = '';
        plainText = 'Demo: ' + liveUrl;
        smsText = 'Demo: ' + liveUrl;
    }

    var draftedMessage = biz.channel === 'sms' ? smsText : plainText;

    // Write to sheet with error logging
    try {
        sheet.appendRow([
            today,
            biz.area || '',
            biz.niche || '',
            biz.business_name || '',
            slug,
            repoUrl,
            liveUrl,
            biz.suggested_domain || '',
            biz.domain_cost || '',
            biz.target_email || '',
            biz.target_phone || '',
            draftedMessage,
            biz.channel || 'sms',
            'Review Needed',
            '',
            biz.place_id || ''
        ]);
        console.log('Sheet row appended successfully for ' + biz.business_name);
    } catch (e) {
        console.error('Sheet appendRow failed:', e);
        return { error: 'Sheet write failed: ' + e.toString() };
    }

    var lastRow = sheet.getLastRow();
    return {
        error: null,
        liveUrl: liveUrl,
        emailHtml: emailHtml,
        plainText: plainText,
        smsText: smsText,
        rowNumber: lastRow
    };
}

// ============================================================
// MESSAGE BUILDERS
// ============================================================

/**
 * Professional HTML email.
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
        '<tr><td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:30px 40px;text-align:center">' +
        '<h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">CyberCraft Solutions</h1>' +
        '<p style="margin:6px 0 0;color:#93c5fd;font-size:13px">Professional Web Design & Development</p>' +
        '</td></tr>' +
        '<tr><td style="padding:36px 40px">' +
        '<p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.6">Hi ' + (biz.business_name || 'there') + ' team,</p>' +
        '<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7">' +
        'I came across <strong>' + biz.business_name + '</strong> while researching ' + (biz.niche || 'local businesses') +
        ' in ' + (biz.area || 'your area') + ', and I noticed your online presence could use an upgrade. ' +
        'So I went ahead and built you a <strong>free custom website demo</strong> — no strings attached.</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
        '<tr><td style="padding:20px 0;text-align:center">' +
        '<a href="' + liveUrl + '" style="display:inline-block;background:#2563eb;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">View Your Free Demo →</a>' +
        '</td></tr></table>' +
        '<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7">' +
        'If you like what you see, the site is yours for a simple <strong>one-time fee of $199</strong>:</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0">' +
        '<tr><td style="padding:4px 10px 4px 0;color:#059669;font-size:18px;vertical-align:top">✓</td><td style="padding:4px 0;color:#374151;font-size:14px">Fully custom single-page website</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#059669;font-size:18px;vertical-align:top">✓</td><td style="padding:4px 0;color:#374151;font-size:14px">Mobile-responsive design</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#059669;font-size:18px;vertical-align:top">✓</td><td style="padding:4px 0;color:#374151;font-size:14px">Professional, modern aesthetics</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#6b7280;font-size:18px;vertical-align:top">•</td><td style="padding:4px 0;color:#6b7280;font-size:14px">Additional pages at extra cost</td></tr>' +
        '<tr><td style="padding:4px 10px 4px 0;color:#6b7280;font-size:18px;vertical-align:top">•</td><td style="padding:4px 0;color:#6b7280;font-size:14px">Ongoing support as monthly add-on</td></tr>' +
        '</table>' +
        paymentButton +
        '<div style="margin:24px 0;padding:16px 20px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px">' +
        '<p style="margin:0;color:#92400e;font-size:13px;line-height:1.6">' +
        '<strong>Please note:</strong> We will reach out for additional information to ensure your website is 100% accurate before finalizing. ' +
        'If we do not hear back, we will proceed using the best publicly available information and cannot be held responsible for any inaccuracies.</p></div>' +
        '<p style="margin:20px 0 0;color:#374151;font-size:15px;line-height:1.7">Looking forward to helping ' + biz.business_name + ' stand out online!</p>' +
        '<p style="margin:16px 0 0;color:#1f2937;font-size:15px;font-weight:600">Best regards,</p>' +
        '<p style="margin:4px 0 0;color:#1f2937;font-size:15px">' + config.senderName + '</p>' +
        '<p style="margin:2px 0 0;color:#6b7280;font-size:13px">Cyber Craft Solutions</p>' +
        '</td></tr>' +
        '<tr><td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb">' +
        '<p style="margin:0;color:#9ca3af;font-size:11px">Cyber Craft Solutions · Professional Web Design</p>' +
        '</td></tr>' +
        '</table></td></tr></table></body></html>';
}

/**
 * Plain-text email (also stored in sheet for readability).
 */
function buildPlainTextMessage(config, biz, liveUrl) {
    var lines = [
        'Hi ' + (biz.business_name || 'there') + ' team,',
        '',
        'I came across ' + biz.business_name + ' while looking at ' + (biz.niche || 'local businesses') +
        ' in ' + (biz.area || 'your area') + ' and noticed your online presence could use an upgrade.',
        'I built you a free website demo — no strings attached.',
        '',
        'View your demo: ' + liveUrl,
        '',
        'The site is yours for a one-time $199 fee.',
        '  ✓ Custom single-page website',
        '  ✓ Mobile-responsive design',
        '  ✓ Professional aesthetics',
        '  • Extra pages available at additional cost',
        '  • Ongoing support as monthly add-on',
        ''
    ];

    if (config.paymentLink) {
        lines.push('Pay securely here: ' + config.paymentLink);
        lines.push('');
    }

    lines.push(
        'Note: We will reach out for additional info to ensure accuracy before finalizing. If we don\'t hear back, we\'ll proceed with publicly available info.',
        '',
        'Best regards,',
        config.senderName,
        'Cyber Craft Solutions'
    );

    return lines.join('\n');
}

/**
 * Short SMS message — soft intro, no pricing.
 */
function buildSmsMessage(config, biz, liveUrl) {
    return 'Hi! I built a free website demo for ' + biz.business_name +
        ' \u2014 check it out: ' + liveUrl +
        '. No cost, no catch. Reply if interested or STOP to opt out. - Cyber Craft Solutions';
}

// ============================================================
// PHASE 4: OUTREACH (Email or SMS)
// ============================================================

/**
 * Sends email via GmailApp.
 */
function sendEmailMessage(targetEmail, subject, htmlBody, plainBody, senderName) {
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
 * Sends SMS via Twilio.
 */
function sendSmsMessage(targetPhone, body, config) {
    if (!config.twilioEnabled) {
        return { success: false, error: 'Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE in Script Properties.' };
    }

    try {
        var url = 'https://api.twilio.com/2010-04-01/Accounts/' + config.twilioSid + '/Messages.json';
        var authHeader = 'Basic ' + Utilities.base64Encode(config.twilioSid + ':' + config.twilioToken);

        var res = UrlFetchApp.fetch(url, {
            method: 'POST',
            headers: { 'Authorization': authHeader },
            payload: {
                'To': normalizePhone(targetPhone),
                'From': config.twilioPhone,
                'Body': body
            },
            muteHttpExceptions: true
        });

        var code = res.getResponseCode();
        if (code >= 200 && code < 300) {
            return { success: true, error: null };
        } else {
            var errBody = res.getContentText();
            console.error('Twilio API error (' + code + '):', errBody);
            return { success: false, error: 'Twilio returned ' + code + ': ' + errBody.substring(0, 200) };
        }
    } catch (e) {
        console.error('Twilio SMS failed:', e);
        return { success: false, error: e.toString() };
    }
}

/**
 * Phase 4: Send via the appropriate channel and update the sheet.
 */
function phaseOutreach(config, biz, logResult) {
    if (!config.autoSend) {
        console.log('AUTO_SEND is off. Message saved for review.');
        return { sent: false, error: null };
    }

    var result;
    var channel = biz.channel || 'email';

    if (channel === 'email' && isValidEmail(biz.target_email)) {
        var subject = 'I built ' + biz.business_name + ' a free website';
        result = sendEmailMessage(biz.target_email, subject, logResult.emailHtml, logResult.plainText, config.senderName);
    } else if (channel === 'sms' && isValidPhone(biz.target_phone)) {
        result = sendSmsMessage(biz.target_phone, logResult.smsText, config);
    } else {
        return { sent: false, error: 'No valid contact for channel: ' + channel };
    }

    if (result.success) {
        var ss = SpreadsheetApp.openById(config.sheetId);
        var sheet = ss.getSheetByName('Leads');
        var statusCol = SHEET_HEADERS.indexOf('Status') + 1;
        var sentDateCol = SHEET_HEADERS.indexOf('Sent_Date') + 1;

        sheet.getRange(logResult.rowNumber, statusCol).setValue('Sent');
        sheet.getRange(logResult.rowNumber, sentDateCol).setValue(new Date().toISOString());

        return { sent: true, error: null };
    }

    return { sent: false, error: result.error };
}

// ============================================================
// BATCH SEND
// ============================================================
function sendAllPending() {
    var config = getConfig();
    if (!config) return;

    var ss = SpreadsheetApp.openById(config.sheetId);
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) { ss.toast('No Leads tab found.', '❌', 5); return; }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var col = {};
    ['Status', 'Drafted_Message', 'Target_Email', 'Target_Phone', 'Business_Name', 'Live_Pages_URL', 'Area', 'Channel', 'Sent_Date'].forEach(function (h) {
        col[h] = headers.indexOf(h);
    });

    var sentCount = 0, skipCount = 0, failCount = 0;

    for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (row[col.Status] !== 'Review Needed') { skipCount++; continue; }

        var channel = (row[col.Channel] || 'email').toLowerCase();
        var targetEmail = row[col.Target_Email];
        var targetPhone = row[col.Target_Phone];
        var businessName = row[col.Business_Name] || 'your business';
        var liveUrl = row[col.Live_Pages_URL] || '';

        var result;
        if (channel === 'email' && isValidEmail(targetEmail)) {
            var fakeBiz = { business_name: businessName, niche: 'local services', area: row[col.Area] || '' };
            var htmlEmail = buildProfessionalEmail(config, fakeBiz, liveUrl);
            var plainEmail = row[col.Drafted_Message] || buildPlainTextMessage(config, fakeBiz, liveUrl);
            result = sendEmailMessage(targetEmail, 'I built ' + businessName + ' a free website', htmlEmail, plainEmail, config.senderName);
        } else if (channel === 'sms' && isValidPhone(targetPhone)) {
            var smsBody = row[col.Drafted_Message] || buildSmsMessage(config, { business_name: businessName }, liveUrl);
            result = sendSmsMessage(targetPhone, smsBody, config);
        } else {
            skipCount++; continue;
        }

        if (result.success) {
            var sheetRow = i + 1;
            sheet.getRange(sheetRow, col.Status + 1).setValue('Sent');
            sheet.getRange(sheetRow, col.Sent_Date + 1).setValue(new Date().toISOString());
            sentCount++;
        } else {
            failCount++;
            console.error('Failed (' + channel + ') row ' + (i + 1) + ': ' + result.error);
        }

        Utilities.sleep(2000);
    }

    ss.toast('✅ Sent: ' + sentCount + ' | Skipped: ' + skipCount + ' | Failed: ' + failCount, '📧 Batch Complete', 10);
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
function runWebsiteForgePipeline() {
    var config = getConfig();
    if (!config) return;

    if (!config.placesApiKey) {
        SpreadsheetApp.getUi().alert('⚠️ PLACES_API_KEY is not set.\n\nAdd your Google Places API key in Script Properties to use the lead discovery pipeline.');
        return;
    }

    var ss = SpreadsheetApp.openById(config.sheetId);
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) {
        sheet = ss.insertSheet('Leads');
    }
    ensureHeaders(sheet);

    // Load existing leads for dedup
    var existingLeads = getExistingLeads(sheet);
    console.log('Existing leads loaded: ' + existingLeads.length);

    // --- Phase 1: Discover via Google Places ---
    var MAX_ATTEMPTS = 5;
    var biz = null;

    for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        var niche = pickRandom(NICHES);
        var city = pickRandom(CITIES);

        ss.toast('Phase 1: Searching "' + niche + '" in "' + city + '" (attempt ' + attempt + '/' + MAX_ATTEMPTS + ')...', '🚀 WebsiteForge', -1);
        SpreadsheetApp.flush();

        var research = findLeadFromPlaces(niche, city, config, existingLeads);

        if (research.data) {
            biz = research.data;
            break;
        }

        console.log('Attempt ' + attempt + ': ' + research.error);
        if (attempt < MAX_ATTEMPTS) {
            ss.toast('No qualifying lead — trying another niche/city (' + attempt + '/' + MAX_ATTEMPTS + ')...', '🔄', 3);
            Utilities.sleep(500);
        }
    }

    if (!biz) {
        ss.toast('No verified leads found after ' + MAX_ATTEMPTS + ' tries. Try again later.', '❌', 10);
        return;
    }

    // --- Phase 1B: LLM generates copy (services + domain ONLY) ---
    ss.toast('Phase 1B: Generating services list for ' + biz.business_name + '...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var copy = generateCopyForLead(biz, config);
    if (!copy.error) {
        biz.services = copy.services;
        biz.suggested_domain = copy.suggested_domain;

        // Check domain availability + pricing
        if (biz.suggested_domain) {
            var domainCheck = checkDomain(biz.suggested_domain, config);
            if (domainCheck.available) {
                biz.domain_cost = domainCheck.price || '';
                console.log('Domain available: ' + biz.suggested_domain + ' — ' + biz.domain_cost);
            } else {
                console.log('Domain taken, clearing suggestion: ' + biz.suggested_domain);
                biz.suggested_domain = '';
                biz.domain_cost = '';
            }
        }
    } else {
        console.warn('Copy generation failed, using defaults: ' + copy.error);
        biz.services = '';
    }

    // --- Twilio phone validation (safety net) ---
    var phoneCheck = validatePhoneWithTwilio(biz.target_phone, config);
    if (!phoneCheck.valid) {
        console.warn('⚠️ Twilio phone validation failed for ' + biz.target_phone + ': ' + (phoneCheck.error || 'type=' + phoneCheck.type));
        // Continue anyway — Google Places is authoritative, Twilio is just a safety net
    } else {
        console.log('Phone validated via Twilio: ' + biz.target_phone + ' (type=' + phoneCheck.type + ')');
    }

    // Generate slug
    biz.slug = toSlug(biz.business_name);

    var contactInfo = '📱 ' + biz.target_phone;
    console.log('Lead ready: ' + biz.business_name + ' | ' + biz.niche + ' | ' + biz.area + ' | ' + contactInfo);

    // --- Phase 2: Build ---
    ss.toast('Phase 2: Building website for ' + biz.business_name + '...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var build = phaseBuild(config, biz);
    if (build.error) {
        ss.toast(build.error, '❌ Phase 2', 10);
        return;
    }

    // --- Phase 3: Deploy & Log ---
    ss.toast('Phase 3: Deploying & logging...', '🚀 WebsiteForge', -1);
    SpreadsheetApp.flush();

    var log = phaseLog(config, biz, build.html);
    if (log.error) {
        ss.toast(log.error, '❌ Phase 3', 10);
        return;
    }

    // --- Phase 4: Outreach ---
    if (config.autoSend) {
        ss.toast('Phase 4: Sending SMS to ' + contactInfo + '...', '🚀 WebsiteForge', -1);
        SpreadsheetApp.flush();

        var outreach = phaseOutreach(config, biz, log);
        if (outreach.sent) {
            ss.toast('✅ Done! SMS sent to ' + contactInfo, '🎉', 15);
        } else if (outreach.error) {
            ss.toast('⚠️ Deployed but send failed: ' + outreach.error, '⚠️', 15);
        }
    } else {
        ss.toast('✅ Done! ' + biz.business_name + ' (' + contactInfo + ') — review in sheet', '🎉', 15);
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
        .addItem('📧 Send All Pending', 'sendAllPending')
        .addItem('🧹 Clear All Leads', 'clearAllLeads')
        .addToUi();
}
