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
 * Handles incoming POST requests from Twilio.
 * Twilio sends form-encoded data with: From, To, Body, MessageSid, etc.
 */
function doPost(e) {
    try {
        var params = e.parameter;
        var from = params.From || '';
        var to = params.To || '';
        var body = (params.Body || '').trim();
        var messageSid = params.MessageSid || '';

        console.log('Incoming SMS from ' + from + ': ' + body);

        // Log to Replies sheet
        logReply(from, to, body, messageSid);

        // Forward to business phone
        forwardToBusinessPhone(from, body);

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
