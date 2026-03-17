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
    'Place_ID',
    'Intake_Services',
    'Intake_Email',
    'Intake_Hours',
    'Intake_ServiceArea',
    'Intake_Notes',
    'Intake_Date'
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

    // Pre-fetch relevant images from Pexels
    var images = searchPexelsImages(niche, servicesList, config);

    // Build service image assignments for the prompt
    var serviceImageLines = [];
    for (var i = 0; i < servicesList.length; i++) {
        var imgUrl = images.services[i] || images.services[0] || images.hero;
        serviceImageLines.push('   - "' + servicesList[i] + '": ' + imgUrl);
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
        '2. IMAGES — USE THESE EXACT URLs (do NOT change or generate your own):',
        '   HERO background image: ' + images.hero,
        '   ABOUT section image: ' + images.about,
        '   Service card images (use the URL next to each service name):',
        serviceImageLines.join('\n'),
        '   Every <img> must use object-cover and have descriptive alt text.',
        '',
        '3. HERO: Full-screen hero with the HERO background image above. Dark gradient overlay.',
        '   Big white heading "' + biz.business_name + '". Subtitle about ' + niche + ' in ' + area + '. CTA button.',
        '',
        '4. NAVBAR: Sticky top navbar with SOLID dark background (bg-slate-900 or bg-gray-900, NOT transparent/glassmorphism). White text. Logo text "' + biz.business_name + '".',
        '',
        '5. SERVICES: Grid of cards — one for each: ' + servicesList.join(', ') + '.',
        '   Each card: use the EXACT image URL assigned above for that service, service name, 2-line description.',
        '   DO NOT put a "Get Quote" or CTA button on each individual card — keep cards clean.',
        '   Instead, add ONE single centered CTA button BELOW the entire services grid that says "Get Your Free Quote" and links to #contact.',
        '',
        '6. ABOUT: Section with the ABOUT image and warm paragraph about the business.',
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

/**
 * Builds an intake form URL pre-filled with the lead's info.
 */
function buildIntakeUrl(biz) {
    var base = 'https://' + CONFIG_ORG + '.github.io/' + CONFIG_REPO + '/intake/';
    var params = '?p=' + encodeURIComponent(biz.target_phone || '');
    if (biz.business_name) {
        params += '&biz=' + encodeURIComponent(biz.business_name);
    }
    return base + params;
}

/**
 * Follow-up SMS sent after a lead replies with interest.
 * Includes the intake form link so they can provide customization details.
 */
function buildIntakeFollowUpSms(biz) {
    return 'Great to hear from you! To customize your site, fill out this quick form (2 min): ' +
        buildIntakeUrl(biz) +
        ' - Cyber Craft Solutions';
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
    var channel = biz.channel || 'sms';

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
    ['Status', 'Drafted_Message', 'Target_Email', 'Target_Phone', 'Business_Name', 'Live_Pages_URL', 'Area', 'Channel', 'Sent_Date', 'Domain_Cost_Yearly'].forEach(function (h) {
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
        var domainCost = (row[col.Domain_Cost_Yearly] || '').toString().trim();


        // Guard: skip leads without verified domain pricing
        if (!domainCost || domainCost.indexOf('$') === -1) {
            console.log('Skipping row ' + (i + 1) + ' (' + businessName + '): no verified domain cost');
            skipCount++; continue;
        }

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
// MAIN ENTRY POINT — Resilient pipeline with auto-retry
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

    var existingLeads = getExistingLeads(sheet);
    console.log('Existing leads loaded: ' + existingLeads.length);

    // ========================================================
    // OUTER RETRY LOOP — keeps trying until we get a sendable lead
    // ========================================================
    var MAX_PIPELINE_ATTEMPTS = 5;

    for (var pAttempt = 1; pAttempt <= MAX_PIPELINE_ATTEMPTS; pAttempt++) {
        console.log('=== Pipeline attempt ' + pAttempt + '/' + MAX_PIPELINE_ATTEMPTS + ' ===');

        // --- Phase 1: Discover via Google Places ---
        var LEAD_ATTEMPTS = 5;
        var biz = null;

        for (var attempt = 1; attempt <= LEAD_ATTEMPTS; attempt++) {
            var niche = pickRandom(NICHES);
            var city = pickRandom(CITIES);

            ss.toast('(' + pAttempt + '/' + MAX_PIPELINE_ATTEMPTS + ') Phase 1: Searching "' + niche + '" in "' + city + '"...', '🚀 WebsiteForge', -1);
            SpreadsheetApp.flush();

            var research = findLeadFromPlaces(niche, city, config, existingLeads);
            if (research.data) {
                biz = research.data;
                break;
            }

            console.log('Lead attempt ' + attempt + ': ' + research.error);
            if (attempt < LEAD_ATTEMPTS) Utilities.sleep(500);
        }

        if (!biz) {
            console.warn('Pipeline attempt ' + pAttempt + ': no lead found in ' + LEAD_ATTEMPTS + ' searches');
            continue; // Try entire pipeline again with new niches/cities
        }

        // --- Twilio phone check (before spending LLM/domain credits) ---
        var phoneCheck = validatePhoneWithTwilio(biz.target_phone, config);
        if (!phoneCheck.valid) {
            console.warn('⚠️ Phone validation failed: ' + biz.target_phone + ' — continuing anyway');
        } else if (!phoneCheck.smsCapable) {
            console.warn('⚠️ LANDLINE: ' + biz.target_phone + ' — pivoting to new lead');
            ss.toast('Landline detected — finding another lead...', '🔄', 3);
            continue; // Next pipeline attempt
        } else {
            console.log('Phone OK: ' + biz.target_phone + ' (type=' + phoneCheck.type + ', SMS capable)');
        }

        // --- Phase 1B: LLM generates copy (services + domains) ---
        ss.toast('(' + pAttempt + '/' + MAX_PIPELINE_ATTEMPTS + ') Phase 1B: Generating copy for ' + biz.business_name + '...', '🚀 WebsiteForge', -1);
        SpreadsheetApp.flush();

        var copy = generateCopyForLead(biz, config);
        if (copy.error) {
            console.warn('Copy generation failed: ' + copy.error + ' — pivoting to new lead');
            continue; // Next pipeline attempt
        }
        biz.services = copy.services;

        // --- Domain check: try first 5, then re-query LLM for 5 more ---
        var allDomains = copy.suggested_domains || [];
        var takenDomains = [];
        biz.suggested_domain = '';
        biz.domain_cost = '';

        // Round 1: check the original 5
        for (var d = 0; d < allDomains.length; d++) {
            console.log('Checking domain ' + (d + 1) + '/' + allDomains.length + ': ' + allDomains[d]);
            var domainCheck = checkDomain(allDomains[d], config);
            if (domainCheck.available) {
                biz.suggested_domain = allDomains[d];
                biz.domain_cost = domainCheck.price || '';
                console.log('✅ Domain available: ' + allDomains[d] + ' — ' + biz.domain_cost);
                break;
            }
            console.log('Domain taken: ' + allDomains[d]);
            takenDomains.push(allDomains[d]);
        }

        // Round 2: if all taken, ask LLM for 5 more creative ones
        if (!biz.suggested_domain && takenDomains.length > 0) {
            console.log('All ' + takenDomains.length + ' domains taken — re-querying LLM for alternatives');
            ss.toast('All domains taken — asking for creative alternatives...', '🔄', 3);

            var moreDomains = generateMoreDomains(biz, takenDomains, config);
            for (var m = 0; m < moreDomains.length; m++) {
                console.log('Checking alt domain ' + (m + 1) + '/' + moreDomains.length + ': ' + moreDomains[m]);
                var altCheck = checkDomain(moreDomains[m], config);
                if (altCheck.available) {
                    biz.suggested_domain = moreDomains[m];
                    biz.domain_cost = altCheck.price || '';
                    console.log('✅ Alt domain available: ' + moreDomains[m] + ' — ' + biz.domain_cost);
                    break;
                }
                console.log('Alt domain taken: ' + moreDomains[m]);
            }
        }

        // If STILL no domain, pivot to a new lead
        if (!biz.suggested_domain) {
            console.warn('All domain suggestions taken after 2 LLM rounds — pivoting to new lead');
            continue; // Next pipeline attempt
        }

        // --- Phase 2: Build website ---
        biz.slug = toSlug(biz.business_name);
        var contactInfo = '📱 ' + biz.target_phone;
        console.log('Lead ready: ' + biz.business_name + ' | ' + biz.niche + ' | ' + biz.area + ' | ' + contactInfo);

        ss.toast('(' + pAttempt + '/' + MAX_PIPELINE_ATTEMPTS + ') Phase 2: Building website for ' + biz.business_name + '...', '🚀 WebsiteForge', -1);
        SpreadsheetApp.flush();

        var build = phaseBuild(config, biz);
        if (build.error) {
            // Retry build once
            console.warn('Build failed: ' + build.error + ' — retrying once');
            ss.toast('Build failed — retrying...', '🔄', 3);
            build = phaseBuild(config, biz);
            if (build.error) {
                console.warn('Build failed twice: ' + build.error + ' — pivoting to new lead');
                continue; // Next pipeline attempt
            }
        }

        // --- Phase 3: Deploy & Log ---
        ss.toast('(' + pAttempt + '/' + MAX_PIPELINE_ATTEMPTS + ') Phase 3: Deploying & logging...', '🚀 WebsiteForge', -1);
        SpreadsheetApp.flush();

        var log = phaseLog(config, biz, build.html);
        if (log.error) {
            // Retry deploy once
            console.warn('Deploy failed: ' + log.error + ' — retrying once');
            Utilities.sleep(2000);
            log = phaseLog(config, biz, build.html);
            if (log.error) {
                console.warn('Deploy failed twice: ' + log.error + ' — pivoting to new lead');
                continue; // Next pipeline attempt
            }
        }

        // --- Phase 4: Outreach (terminal step — pipeline done after this) ---
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

        return; // SUCCESS — exit pipeline
    }

    // If we get here, all pipeline attempts exhausted
    ss.toast('Pipeline exhausted ' + MAX_PIPELINE_ATTEMPTS + ' attempts without producing a sendable lead. Try again later.', '❌', 15);
}

// ============================================================
// BACKFILL — Fill in empty cells on existing rows
// ============================================================

/**
 * Scans every row in the Leads sheet and tries to fill in empty cells.
 * 
 * Backfills:
 *   - Suggested_Domain + Domain_Cost_Yearly: re-queries LLM for domains, checks DomScan
 *   - Domain_Cost_Yearly only (when domain exists but price is missing): re-checks DomScan
 *   - Drafted_Message: regenerates SMS/email text from business data + live URL
 * 
 * Skips rows with Status = 'Sent'.
 */
function backfillLeads() {
    var config = getConfig();
    if (!config) return;

    var ss = SpreadsheetApp.openById(config.sheetId);
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) { ss.toast('No Leads tab found.', '❌', 5); return; }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    // Build column index map
    var col = {};
    SHEET_HEADERS.forEach(function (h) { col[h] = headers.indexOf(h); });

    var fixedCount = 0;
    var skippedCount = 0;
    var totalRows = data.length - 1;

    for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var rowNum = i + 1;
        var businessName = row[col.Business_Name] || '';
        var status = (row[col.Status] || '').toString().trim();

        // Skip sent rows — don't touch them
        if (status === 'Sent') { skippedCount++; continue; }
        if (!businessName) { skippedCount++; continue; }

        var area = row[col.Area] || '';
        var niche = row[col.Niche] || '';
        var phone = row[col.Target_Phone] || '';
        var liveUrl = row[col.Live_Pages_URL] || '';
        var domain = (row[col.Suggested_Domain] || '').toString().trim();
        var domainCost = (row[col.Domain_Cost_Yearly] || '').toString().trim();
        var draftedMsg = (row[col.Drafted_Message] || '').toString().trim();
        var channel = (row[col.Channel] || 'sms').toString().trim();
        var rowFixed = false;

        ss.toast('Backfilling row ' + rowNum + '/' + (totalRows + 1) + ': ' + businessName + '...', '🔧 Backfill', -1);

        // --- 1. Missing domain: generate suggestions via LLM + check availability ---
        if (!domain) {
            console.log('Row ' + rowNum + ' (' + businessName + '): missing domain — generating');
            var biz = {
                business_name: businessName,
                niche: niche,
                area: area,
                address: ''
            };

            var copy = generateCopyForLead(biz, config);
            if (!copy.error && copy.suggested_domains.length > 0) {
                // Check each suggestion
                for (var d = 0; d < copy.suggested_domains.length; d++) {
                    var check = checkDomain(copy.suggested_domains[d], config);
                    if (check.available) {
                        domain = copy.suggested_domains[d];
                        domainCost = check.price || '';
                        sheet.getRange(rowNum, col.Suggested_Domain + 1).setValue(domain);
                        sheet.getRange(rowNum, col.Domain_Cost_Yearly + 1).setValue(domainCost);
                        console.log('Row ' + rowNum + ': filled domain = ' + domain + ' (' + domainCost + ')');
                        rowFixed = true;
                        break;
                    }
                }

                // Round 2 if all taken
                if (!domain) {
                    var takenList = copy.suggested_domains;
                    var moreDomains = generateMoreDomains(biz, takenList, config);
                    for (var m = 0; m < moreDomains.length; m++) {
                        var altCheck = checkDomain(moreDomains[m], config);
                        if (altCheck.available) {
                            domain = moreDomains[m];
                            domainCost = altCheck.price || '';
                            sheet.getRange(rowNum, col.Suggested_Domain + 1).setValue(domain);
                            sheet.getRange(rowNum, col.Domain_Cost_Yearly + 1).setValue(domainCost);
                            console.log('Row ' + rowNum + ': filled alt domain = ' + domain + ' (' + domainCost + ')');
                            rowFixed = true;
                            break;
                        }
                    }
                }

                // Also backfill services if they came back and were missing
                var existingServices = (row[col.Niche] || '').toString().trim(); // niche is always there
                // Services are not in the sheet headers currently, so skip
            }
        }

        // --- 2. Domain exists but no pricing: re-check DomScan ---
        if (domain && (!domainCost || domainCost.indexOf('$') === -1)) {
            console.log('Row ' + rowNum + ' (' + businessName + '): has domain but no price — re-checking');
            var priceCheck = checkDomain(domain, config);
            if (priceCheck.available && priceCheck.price) {
                domainCost = priceCheck.price;
                sheet.getRange(rowNum, col.Domain_Cost_Yearly + 1).setValue(domainCost);
                console.log('Row ' + rowNum + ': filled price = ' + domainCost);
                rowFixed = true;
            } else if (!priceCheck.available) {
                // Domain was taken since last check — clear it
                console.warn('Row ' + rowNum + ': domain ' + domain + ' is now taken — clearing');
                sheet.getRange(rowNum, col.Suggested_Domain + 1).setValue('');
                sheet.getRange(rowNum, col.Domain_Cost_Yearly + 1).setValue('');
                rowFixed = true;
            }
        }

        // --- 3. Missing drafted message: regenerate ---
        if (!draftedMsg && liveUrl) {
            console.log('Row ' + rowNum + ' (' + businessName + '): missing message — regenerating');
            var fakeBiz = { business_name: businessName, niche: niche, area: area };

            if (channel === 'sms') {
                var smsMsg = buildSmsMessage(config, fakeBiz, liveUrl);
                sheet.getRange(rowNum, col.Drafted_Message + 1).setValue(smsMsg);
            } else {
                var plainMsg = buildPlainTextMessage(config, fakeBiz, liveUrl);
                sheet.getRange(rowNum, col.Drafted_Message + 1).setValue(plainMsg);
            }
            console.log('Row ' + rowNum + ': filled drafted message');
            rowFixed = true;
        }

        if (rowFixed) fixedCount++;
        Utilities.sleep(500); // Pace API calls
    }

    ss.toast('✅ Backfill complete! Fixed: ' + fixedCount + ' rows | Skipped: ' + skippedCount, '🔧', 10);
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
        .addItem('🔧 Backfill Empty Cells', 'backfillLeads')
        .addItem('🧹 Clear All Leads', 'clearAllLeads')
        .addToUi();
}
