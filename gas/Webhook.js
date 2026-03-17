/**
 * Webhook.js — Twilio inbound SMS webhook handler
 *
 * Receives incoming SMS replies via Twilio webhook and:
 *   1. Logs the reply to a "Replies" sheet
 *   2. Forwards the message to your business phone via SMS
 *
 * Setup:
 *   1. Deploy this Apps Script as a Web App (Execute as: Me, Access: Anyone)
 *   2. Copy the web app URL
 *   3. In Twilio Console: Phone Numbers > your toll-free number > Messaging Configuration
 *      Set "A message comes in" webhook to your web app URL (HTTP POST)
 *   4. Set FORWARD_PHONE in Script Properties to your personal/business number
 */

/**
 * Handles incoming POST requests from Twilio (SMS) and the intake form.
 * Routes based on whether the payload contains a MessageSid (Twilio) or formType (intake).
 */
function doPost(e) {
    try {
        var params = e.parameter;

        // Route: intake form submission
        if (params.formType === 'intake') {
            return handleIntakeForm(params);
        }

        // Route: Twilio inbound SMS (has MessageSid)
        var from = params.From || '';
        var to = params.To || '';
        var body = (params.Body || '').trim();
        var messageSid = params.MessageSid || '';

        console.log('Incoming SMS from ' + from + ': ' + body);

        // Log to Replies sheet
        logReply(from, to, body, messageSid);

        // Forward to business phone
        forwardToBusinessPhone(from, body);

        // Auto-send intake form link if reply looks positive
        if (isPositiveReply(body)) {
            sendIntakeLink(from);
        }

        // Return empty TwiML — Twilio handles STOP/START/HELP automatically
        // before this webhook fires, so we just need to handle real replies
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
        var sheetId = props.getProperty('SHEET_ID') || '1rP0SS64lhjP3ui3eV93e0PHnrhRb0OfHyj3IMZCKOp4';
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
            from,
            to,
            body,
            messageSid
        ]);

        // Also update the lead's status in the Leads sheet if we can match the phone
        updateLeadStatus(ss, from);

    } catch (err) {
        console.error('logReply error:', err);
    }
}

/**
 * Updates the lead's Status to "Replied" when we get an inbound SMS.
 */
function updateLeadStatus(ss, fromPhone) {
    try {
        var sheet = ss.getSheetByName('Leads');
        if (!sheet) return;

        var data = sheet.getDataRange().getValues();
        var headers = data[0];
        var phoneCol = headers.indexOf('Target_Phone');
        var statusCol = headers.indexOf('Status');

        if (phoneCol === -1 || statusCol === -1) return;

        // Normalize the incoming phone for comparison
        var normalizedFrom = fromPhone.replace(/[^0-9]/g, '');
        if (normalizedFrom.length === 11 && normalizedFrom[0] === '1') {
            normalizedFrom = normalizedFrom.substring(1);
        }

        for (var i = 1; i < data.length; i++) {
            var rowPhone = (data[i][phoneCol] || '').toString().replace(/[^0-9]/g, '');
            if (rowPhone.length === 11 && rowPhone[0] === '1') {
                rowPhone = rowPhone.substring(1);
            }

            if (rowPhone === normalizedFrom && rowPhone.length === 10) {
                var currentStatus = (data[i][statusCol] || '').toString();
                if (currentStatus === 'Sent') {
                    sheet.getRange(i + 1, statusCol + 1).setValue('Replied');
                    console.log('Updated row ' + (i + 1) + ' status to Replied');
                }
                break;
            }
        }
    } catch (err) {
        console.error('updateLeadStatus error:', err);
    }
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
        var businessName  = (params.business_name || '').trim();
        var services      = (params.services || '').trim();
        var email         = (params.email || '').trim();
        var hours         = (params.hours || '').trim();
        var serviceArea   = (params.service_area || '').trim();
        var notes         = (params.notes || '').trim();

        console.log('Intake form received for: ' + businessName + ' (' + phone + ')');

        var props = PropertiesService.getScriptProperties();
        var sheetId = props.getProperty('SHEET_ID') || '1rP0SS64lhjP3ui3eV93e0PHnrhRb0OfHyj3IMZCKOp4';
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('Leads');

        if (!sheet) {
            console.error('Intake: No Leads sheet found');
            return jsonResponse({ status: 'error', message: 'Sheet not found' });
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

        // Forward notification to business phone
        forwardIntakeNotification(businessName, phone, services);

        return jsonResponse({ status: 'ok', matched: matched });

    } catch (err) {
        console.error('handleIntakeForm error:', err);
        return jsonResponse({ status: 'error', message: err.toString() });
    }
}

/**
 * Sends an SMS notification when a lead submits the intake form.
 */
function forwardIntakeNotification(businessName, phone, services) {
    var props = PropertiesService.getScriptProperties();
    var forwardPhone = (props.getProperty('FORWARD_PHONE') || '').trim();
    var twilioSid = (props.getProperty('TWILIO_ACCOUNT_SID') || '').trim();
    var twilioToken = (props.getProperty('TWILIO_AUTH_TOKEN') || '').trim();
    var twilioPhone = (props.getProperty('TWILIO_PHONE') || '').trim();

    if (!forwardPhone || !twilioSid || !twilioToken || !twilioPhone) return;

    var msg = 'New intake form!\n' +
        businessName + ' (' + phone + ')\n' +
        'Services: ' + (services || 'not provided').substring(0, 100);

    try {
        var url = 'https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json';
        var authHeader = 'Basic ' + Utilities.base64Encode(twilioSid + ':' + twilioToken);

        UrlFetchApp.fetch(url, {
            method: 'POST',
            headers: { 'Authorization': authHeader },
            payload: { 'To': forwardPhone, 'From': twilioPhone, 'Body': msg },
            muteHttpExceptions: true
        });
    } catch (err) {
        console.error('forwardIntakeNotification error:', err);
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

/**
 * Checks if an inbound SMS reply indicates positive interest.
 */
function isPositiveReply(body) {
    var lower = (body || '').toLowerCase().trim();
    var positiveWords = ['yes', 'yeah', 'yep', 'yea', 'sure', 'interested',
        'tell me more', 'more info', 'sounds good', 'let\'s do it', 'sign me up',
        'how much', 'pricing', 'cost', 'ready', 'let\'s go', 'absolutely', 'definitely'];
    for (var i = 0; i < positiveWords.length; i++) {
        if (lower.indexOf(positiveWords[i]) !== -1) return true;
    }
    return false;
}

/**
 * Sends the intake form link to a lead who replied positively.
 * Looks up the lead in the sheet to build a pre-filled URL.
 */
function sendIntakeLink(fromPhone) {
    try {
        var props = PropertiesService.getScriptProperties();
        var sheetId = props.getProperty('SHEET_ID') || '1rP0SS64lhjP3ui3eV93e0PHnrhRb0OfHyj3IMZCKOp4';
        var twilioSid = (props.getProperty('TWILIO_ACCOUNT_SID') || '').trim();
        var twilioToken = (props.getProperty('TWILIO_AUTH_TOKEN') || '').trim();
        var twilioPhone = (props.getProperty('TWILIO_PHONE') || '').trim();

        if (!twilioSid || !twilioToken || !twilioPhone) return;

        // Look up the lead to get business name
        var ss = SpreadsheetApp.openById(sheetId);
        var sheet = ss.getSheetByName('Leads');
        if (!sheet) return;

        var data = sheet.getDataRange().getValues();
        var headers = data[0];
        var phoneCol = headers.indexOf('Target_Phone');
        var nameCol = headers.indexOf('Business_Name');
        if (phoneCol === -1) return;

        var normalizedFrom = fromPhone.replace(/[^0-9]/g, '');
        if (normalizedFrom.length === 11 && normalizedFrom[0] === '1') {
            normalizedFrom = normalizedFrom.substring(1);
        }

        var bizName = '';
        for (var i = 1; i < data.length; i++) {
            var rowPhone = (data[i][phoneCol] || '').toString().replace(/[^0-9]/g, '');
            if (rowPhone.length === 11 && rowPhone[0] === '1') {
                rowPhone = rowPhone.substring(1);
            }
            if (rowPhone === normalizedFrom && rowPhone.length === 10) {
                bizName = data[i][nameCol] || '';
                break;
            }
        }

        var biz = { target_phone: fromPhone, business_name: bizName };
        var msg = buildIntakeFollowUpSms(biz);

        var url = 'https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json';
        var authHeader = 'Basic ' + Utilities.base64Encode(twilioSid + ':' + twilioToken);

        var res = UrlFetchApp.fetch(url, {
            method: 'POST',
            headers: { 'Authorization': authHeader },
            payload: { 'To': fromPhone, 'From': twilioPhone, 'Body': msg },
            muteHttpExceptions: true
        });

        var code = res.getResponseCode();
        if (code >= 200 && code < 300) {
            console.log('Sent intake link to ' + fromPhone);
        } else {
            console.error('Failed to send intake link (' + code + '): ' + res.getContentText().substring(0, 200));
        }
    } catch (err) {
        console.error('sendIntakeLink error:', err);
    }
}

/**
 * Forwards an inbound SMS to your business phone number.
 */
function forwardToBusinessPhone(from, body) {
    var props = PropertiesService.getScriptProperties();
    var forwardPhone = (props.getProperty('FORWARD_PHONE') || '').trim();
    var twilioSid = (props.getProperty('TWILIO_ACCOUNT_SID') || '').trim();
    var twilioToken = (props.getProperty('TWILIO_AUTH_TOKEN') || '').trim();
    var twilioPhone = (props.getProperty('TWILIO_PHONE') || '').trim();

    if (!forwardPhone) {
        console.warn('FORWARD_PHONE not set — reply logged but not forwarded');
        return;
    }

    if (!twilioSid || !twilioToken || !twilioPhone) {
        console.warn('Twilio credentials missing — cannot forward');
        return;
    }

    var forwardBody = 'Reply from ' + from + ':\n' + body;

    try {
        var url = 'https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json';
        var authHeader = 'Basic ' + Utilities.base64Encode(twilioSid + ':' + twilioToken);

        var res = UrlFetchApp.fetch(url, {
            method: 'POST',
            headers: { 'Authorization': authHeader },
            payload: {
                'To': forwardPhone,
                'From': twilioPhone,
                'Body': forwardBody
            },
            muteHttpExceptions: true
        });

        var code = res.getResponseCode();
        if (code >= 200 && code < 300) {
            console.log('Forwarded reply from ' + from + ' to ' + forwardPhone);
        } else {
            console.error('Forward SMS failed (' + code + '): ' + res.getContentText().substring(0, 200));
        }
    } catch (err) {
        console.error('forwardToBusinessPhone error:', err);
    }
}
