/**
 * Webhook.js — Twilio inbound SMS webhook handler
 *
 * Receives incoming SMS replies via Twilio webhook and:
 *   1. Logs the reply to a "Replies" sheet
 *   2. Updates the lead's status to "Replied" in the Leads sheet
 *   3. Handles intake form submissions (matches to lead, writes to sheet)
 *
 * Setup:
 *   1. Deploy this Apps Script as a Web App (Execute as: Me, Access: Anyone)
 *   2. Copy the web app URL
 *   3. In Twilio Console: Phone Numbers > your toll-free number > Messaging Configuration
 *      Set "A message comes in" webhook to your web app URL (HTTP POST)
 *   4. Set INTAKE_TOKEN in Script Properties to a random string
 *      to protect the intake form from unauthorized submissions (required)
 */

/**
 * Validates that the incoming request looks like a real Twilio SMS webhook.
 * GAS web apps cannot access HTTP headers, so true HMAC-SHA1 signature
 * validation is not possible. Instead we verify:
 *   1. TWILIO_AUTH_TOKEN is configured (proves Twilio is set up)
 *   2. MessageSid matches Twilio's format (34 chars, starts with "SM")
 */
function validateTwilioSignature(e) {
    var props = PropertiesService.getScriptProperties();
    var authToken = (props.getProperty('TWILIO_AUTH_TOKEN') || '').trim();
    if (!authToken) return false; // can't validate without token

    // GAS doesn't expose HTTP headers, so we can't verify X-Twilio-Signature.
    // Best-effort: verify MessageSid matches Twilio's known format.
    var messageSid = (e.parameter.MessageSid || '');
    if (!messageSid || messageSid.length !== 34 || messageSid.substring(0, 2) !== 'SM') {
        return false;
    }
    return true;
}

/**
 * Validates intake form signature using HMAC-SHA256(phone_digits, INTAKE_TOKEN).
 * The secret never leaves GAS — only the signature is in the URL.
 */
function validateIntakeToken(params) {
    var props = PropertiesService.getScriptProperties();
    var secret = (props.getProperty('INTAKE_TOKEN') || '').trim();
    if (!secret) {
        console.warn('INTAKE_TOKEN not configured — rejecting intake submission');
        return false;
    }

    var provided = (params.tk || '').trim();
    if (!provided) return false;

    // Recompute HMAC from the phone digits and compare
    var phone = (params.phone || '').replace(/[^0-9]/g, '');
    if (!phone) return false;

    var sigBytes = Utilities.computeHmacSha256Signature(phone, secret);
    var expected = sigBytes.map(function(b) {
        return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');

    return provided === expected;
}

/**
 * Simple rate-limit check: prevents the same phone from submitting intake
 * more than once per 5-minute window. Uses CacheService.
 */
function isRateLimited(key) {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'rl_' + key.replace(/[^a-zA-Z0-9]/g, '');
    if (cache.get(cacheKey)) return true;
    cache.put(cacheKey, '1', 300); // 5-minute cooldown
    return false;
}

/**
 * Handles incoming POST requests from Twilio (SMS) and the intake form.
 * Routes based on whether the payload contains a MessageSid (Twilio) or formType (intake).
 */
function doPost(e) {
    try {
        var params = e.parameter;

        // Route: intake form submission
        if (params.formType === 'intake') {
            // Validate intake token
            if (!validateIntakeToken(params)) {
                console.warn('Intake rejected: invalid token');
                return jsonResponse({ status: 'error', message: 'Unauthorized' });
            }
            // Rate limit by phone
            var phone = (params.phone || '').replace(/[^0-9]/g, '');
            if (phone && isRateLimited('intake_' + phone)) {
                console.warn('Intake rate-limited: ' + phone);
                return jsonResponse({ status: 'ok', message: 'Already received' });
            }
            return handleIntakeForm(params);
        }

        // Route: Twilio inbound SMS — validate it looks like a real Twilio request
        if (!validateTwilioSignature(e)) {
            console.warn('Rejected: invalid Twilio signature/format');
            return ContentService
                .createTextOutput('<Response></Response>')
                .setMimeType(ContentService.MimeType.XML);
        }

        var from = params.From || '';
        var to = params.To || '';
        var body = (params.Body || '').trim();
        var messageSid = params.MessageSid || '';

        console.log('Incoming SMS from ' + from + ': ' + body);

        // Log to Replies sheet + update lead status + send email notification
        logReply(from, to, body, messageSid);

        return ContentService
            .createTextOutput('<Response></Response>')
            .setMimeType(ContentService.MimeType.XML);

    } catch (err) {
        console.error('doPost error:', err);
        return ContentService
            .createTextOutput('<Response></Response>')
            .setMimeType(ContentService.MimeType.XML);
    }
}

/**
 * Logs an inbound SMS reply to the "Replies" sheet.
 */
function logReply(from, to, body, messageSid) {
    try {
        var props = PropertiesService.getScriptProperties();
        var sheetId = props.getProperty('SHEET_ID');
        if (!sheetId) {
            console.error('SHEET_ID not configured in Script Properties');
            return;
        }
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('Replies');

        if (!sheet) {
            sheet = ss.insertSheet('Replies');
            sheet.getRange(1, 1, 1, 5).setValues([['Timestamp', 'From', 'To', 'Body', 'MessageSid']]);
            sheet.getRange(1, 1, 1, 5)
                .setFontWeight('bold')
                .setBackground('#1a1a2e')
                .setFontColor('#ffffff');
        }

        sheet.appendRow([
            new Date().toISOString(),
            sanitizeCell(from),
            sanitizeCell(to),
            sanitizeCell(body),
            messageSid
        ]);

        // Also update the lead's status + first reply in the Leads sheet
        updateLeadStatus(ss, from, body);

    } catch (err) {
        console.error('logReply error:', err);
    }
}

/**
 * Updates the lead's status and sends email notification on inbound SMS.
 *
 * STOP/UNSUBSCRIBE/CANCEL/QUIT/END → Status = "Stopped" (prevents ALL future contact)
 * Anything else → Status = "Replied" + email notification to script owner
 *
 * Status is updated regardless of current value — a STOP from a "Replied" or
 * "Review Needed" lead must still be honored.
 */
function updateLeadStatus(ss, fromPhone, replyBody) {
    try {
        var sheet = ss.getSheetByName('Leads');
        if (!sheet) return;

        var data = sheet.getDataRange().getValues();
        var headers = data[0];
        var phoneCol = headers.indexOf('Target_Phone');
        var statusCol = headers.indexOf('Status');
        var replyCol = headers.indexOf('First_Reply');
        var nameCol = headers.indexOf('Business_Name');

        if (phoneCol === -1 || statusCol === -1) return;

        // Normalize the incoming phone for comparison
        var normalizedFrom = fromPhone.replace(/[^0-9]/g, '');
        if (normalizedFrom.length === 11 && normalizedFrom[0] === '1') {
            normalizedFrom = normalizedFrom.substring(1);
        }

        // Detect opt-out keywords
        var isStop = /^\s*(stop|unsubscribe|cancel|quit|end)\s*$/i.test(replyBody);

        var matched = false;
        for (var i = 1; i < data.length; i++) {
            var rowPhone = (data[i][phoneCol] || '').toString().replace(/[^0-9]/g, '');
            if (rowPhone.length === 11 && rowPhone[0] === '1') {
                rowPhone = rowPhone.substring(1);
            }

            if (rowPhone === normalizedFrom && rowPhone.length === 10) {
                var rowNum = i + 1;
                var businessName = (nameCol !== -1 ? data[i][nameCol] : '') || 'Unknown';
                matched = true;

                if (isStop) {
                    // STOP — mark as Stopped so pipeline + batch send skip this lead
                    sheet.getRange(rowNum, statusCol + 1).setValue('Stopped');
                    if (replyCol !== -1) {
                        sheet.getRange(rowNum, replyCol + 1).setValue('STOP — ' + new Date().toISOString());
                    }
                    console.log('STOP received from ' + businessName + ' (' + fromPhone + ') — row ' + rowNum + ' marked Stopped');
                } else {
                    // Real reply — always update status (even from "Review Needed" or "Sent")
                    sheet.getRange(rowNum, statusCol + 1).setValue('Replied');
                    console.log('Updated row ' + rowNum + ' (' + businessName + ') status to Replied');

                    // Write first reply only if the column exists and is empty
                    if (replyCol !== -1 && !data[i][replyCol]) {
                        sheet.getRange(rowNum, replyCol + 1).setValue(sanitizeCell(replyBody || ''));
                        console.log('Captured first reply for row ' + rowNum);
                    }

                    // Email notification for non-STOP replies
                    notifyOwnerByEmail(
                        'SMS Reply from ' + businessName + ' (' + fromPhone + ')',
                        'You received a reply from a lead!\n\n' +
                        'Business: ' + businessName + '\n' +
                        'Phone: ' + fromPhone + '\n' +
                        'Message: "' + replyBody + '"\n\n' +
                        'Row: ' + rowNum + ' in the Leads sheet\n' +
                        'Reply directly to ' + fromPhone + ' to continue the conversation.'
                    );
                }
                break;
            }
        }

        // If no matching lead found, still notify (could be a wrong number or old lead)
        if (!matched) {
            console.log('No matching lead for phone ' + fromPhone);
            notifyOwnerByEmail(
                'SMS from unknown number: ' + fromPhone,
                'Received SMS from ' + fromPhone + ' (not found in Leads sheet):\n\n"' + replyBody + '"'
            );
        }
    } catch (err) {
        console.error('updateLeadStatus error:', err);
    }
}

/**
 * Sends an email notification to the script owner (the Gmail account running this script).
 * Zero cost — uses GmailApp, no Twilio SMS charge.
 */
function notifyOwnerByEmail(subject, body) {
    try {
        var ownerEmail = Session.getEffectiveUser().getEmail();
        if (!ownerEmail) {
            console.error('notifyOwnerByEmail: could not determine owner email');
            return;
        }
        GmailApp.sendEmail(ownerEmail, '[WebsiteForge] ' + subject, body);
        console.log('Notification email sent to ' + ownerEmail + ': ' + subject);
    } catch (e) {
        console.error('notifyOwnerByEmail failed: ' + e);
    }
}

/**
 * Sanitizes a string before writing to a spreadsheet cell.
 * Prevents formula injection by prefixing dangerous leading characters
 * with a single-quote, which forces Google Sheets to treat the cell as text.
 */
function sanitizeCell(value) {
    if (typeof value !== 'string') return value;
    if (/^[=+\-@\t\r]/.test(value)) {
        return "'" + value;
    }
    return value;
}

// ============================================================
// INTAKE FORM HANDLER
// ============================================================

/**
 * Handles intake form submissions from the GitHub Pages form.
 * Matches the submission to a lead by phone number and updates
 * the intake columns in the Leads sheet.
 */
function handleIntakeForm(params) {
    try {
        var phone         = (params.phone || '').trim();
        var businessName  = sanitizeCell((params.business_name || '').trim());
        var services      = sanitizeCell((params.services || '').trim());
        var email         = sanitizeCell((params.email || '').trim());
        var hours         = sanitizeCell((params.hours || '').trim());
        var serviceArea   = sanitizeCell((params.service_area || '').trim());
        var notes         = sanitizeCell((params.notes || '').trim());

        console.log('Intake form received for: ' + businessName + ' (' + phone + ')');

        var props = PropertiesService.getScriptProperties();
        var sheetId = props.getProperty('SHEET_ID');
        if (!sheetId) {
            console.error('SHEET_ID not configured in Script Properties');
            return jsonResponse({ status: 'error', message: 'Server misconfigured' });
        }
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('Leads');

        if (!sheet) {
            console.error('Intake: No Leads sheet found');
            return jsonResponse({ status: 'error', message: 'Server misconfigured' });
        }

        var data = sheet.getDataRange().getValues();
        var headers = data[0];

        // Find intake columns (added to the end of SHEET_HEADERS)
        var intakeColMap = {
            'Intake_Services': services,
            'Intake_Email': email,
            'Intake_Hours': hours,
            'Intake_ServiceArea': serviceArea,
            'Intake_Notes': notes,
            'Intake_Date': new Date().toISOString()
        };

        // Ensure intake columns exist in headers
        var lastHeaderCol = headers.length;
        var intakeHeaders = Object.keys(intakeColMap);
        var colIndices = {};

        for (var h = 0; h < intakeHeaders.length; h++) {
            var idx = headers.indexOf(intakeHeaders[h]);
            if (idx === -1) {
                // Add the header column
                lastHeaderCol++;
                sheet.getRange(1, lastHeaderCol).setValue(intakeHeaders[h])
                    .setFontWeight('bold')
                    .setBackground('#1a1a2e')
                    .setFontColor('#ffffff');
                colIndices[intakeHeaders[h]] = lastHeaderCol;
                headers.push(intakeHeaders[h]); // keep in sync
            } else {
                colIndices[intakeHeaders[h]] = idx + 1; // 1-indexed
            }
        }

        // Match lead by phone number
        var phoneCol = headers.indexOf('Target_Phone');
        var statusCol = headers.indexOf('Status');
        var matched = false;

        if (phoneCol !== -1 && phone) {
            var normalizedPhone = phone.replace(/[^0-9]/g, '');
            if (normalizedPhone.length === 11 && normalizedPhone[0] === '1') {
                normalizedPhone = normalizedPhone.substring(1);
            }

            for (var i = 1; i < data.length; i++) {
                var rowPhone = (data[i][phoneCol] || '').toString().replace(/[^0-9]/g, '');
                if (rowPhone.length === 11 && rowPhone[0] === '1') {
                    rowPhone = rowPhone.substring(1);
                }

                if (rowPhone === normalizedPhone && rowPhone.length === 10) {
                    // Write intake data to this row
                    for (var key in intakeColMap) {
                        if (intakeColMap[key]) {
                            sheet.getRange(i + 1, colIndices[key]).setValue(intakeColMap[key]);
                        }
                    }

                    // Update status to indicate they submitted the form
                    if (statusCol !== -1) {
                        sheet.getRange(i + 1, statusCol + 1).setValue('Intake Received');
                    }

                    console.log('Intake matched to row ' + (i + 1) + ': ' + businessName);
                    matched = true;
                    break;
                }
            }
        }

        // If no match by phone, try matching by business name
        if (!matched && businessName) {
            var nameCol = headers.indexOf('Business_Name');
            if (nameCol !== -1) {
                var lowerBiz = businessName.toLowerCase();
                for (var j = 1; j < data.length; j++) {
                    var rowName = (data[j][nameCol] || '').toString().toLowerCase();
                    if (rowName === lowerBiz) {
                        for (var key2 in intakeColMap) {
                            if (intakeColMap[key2]) {
                                sheet.getRange(j + 1, colIndices[key2]).setValue(intakeColMap[key2]);
                            }
                        }
                        if (statusCol !== -1) {
                            sheet.getRange(j + 1, statusCol + 1).setValue('Intake Received');
                        }
                        console.log('Intake matched by name to row ' + (j + 1) + ': ' + businessName);
                        matched = true;
                        break;
                    }
                }
            }
        }

        // If still no match, log as unmatched intake at the bottom
        if (!matched) {
            console.warn('Intake: no matching lead for phone=' + phone + ' biz=' + businessName);
            var intakeSheet = ss.getSheetByName('Intake_Unmatched');
            if (!intakeSheet) {
                intakeSheet = ss.insertSheet('Intake_Unmatched');
                intakeSheet.getRange(1, 1, 1, 8).setValues([[
                    'Timestamp', 'Business_Name', 'Phone', 'Email',
                    'Services', 'Hours', 'Service_Area', 'Notes'
                ]]);
                intakeSheet.getRange(1, 1, 1, 8)
                    .setFontWeight('bold')
                    .setBackground('#1a1a2e')
                    .setFontColor('#ffffff');
            }
            intakeSheet.appendRow([
                new Date().toISOString(), businessName, phone, email,
                services, hours, serviceArea, notes
            ]);
        }

        return jsonResponse({ status: 'ok', matched: matched });

    } catch (err) {
        console.error('handleIntakeForm error:', err);
        return jsonResponse({ status: 'error', message: 'Internal error' });
    }
}


/**
 * Returns a JSON response for the intake form.
 */
function jsonResponse(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

