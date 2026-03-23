/**
 * FollowUp.js — Automated SMS follow-up sequence + compliance logging + dashboard
 *
 * Sends up to 3 texts per lead over ~14 days:
 *   Text 1 (Day 0)  — Initial pitch (sent by Pipeline.js / sendAllPending)
 *   Text 2 (Day 3+) — Gentle follow-up
 *   Text 3 (Day 7+) — Final follow-up
 *   Day 14+          — Mark as "Completed" (no more contact)
 *
 * Respects:
 *   - STOP/opted-out leads (never contacts)
 *   - Replied leads (stops sequence)
 *   - Time windows (10 AM – 12 PM in the lead's local timezone)
 *   - No Sundays
 *   - Max 3 texts ever per lead
 *
 * Setup:
 *   Run installFollowUpTrigger() once from the menu to start the hourly check.
 *   Run removeFollowUpTrigger() to disable.
 */

// ============================================================
// TIMEZONE MAPPING (US state abbreviation → IANA timezone)
// ============================================================
var STATE_TIMEZONES = {
    'AL': 'America/Chicago',    'AK': 'America/Anchorage',  'AZ': 'America/Phoenix',
    'AR': 'America/Chicago',    'CA': 'America/Los_Angeles', 'CO': 'America/Denver',
    'CT': 'America/New_York',   'DC': 'America/New_York',   'DE': 'America/New_York',
    'FL': 'America/New_York',   'GA': 'America/New_York',   'HI': 'Pacific/Honolulu',
    'IA': 'America/Chicago',    'ID': 'America/Boise',      'IL': 'America/Chicago',
    'IN': 'America/Indiana/Indianapolis',                     'KS': 'America/Chicago',
    'KY': 'America/New_York',   'LA': 'America/Chicago',    'MA': 'America/New_York',
    'MD': 'America/New_York',   'ME': 'America/New_York',   'MI': 'America/Detroit',
    'MN': 'America/Chicago',    'MO': 'America/Chicago',    'MS': 'America/Chicago',
    'MT': 'America/Denver',     'NC': 'America/New_York',   'ND': 'America/Chicago',
    'NE': 'America/Chicago',    'NH': 'America/New_York',   'NJ': 'America/New_York',
    'NM': 'America/Denver',     'NV': 'America/Los_Angeles','NY': 'America/New_York',
    'OH': 'America/New_York',   'OK': 'America/Chicago',    'OR': 'America/Los_Angeles',
    'PA': 'America/New_York',   'RI': 'America/New_York',   'SC': 'America/New_York',
    'SD': 'America/Chicago',    'TN': 'America/Chicago',    'TX': 'America/Chicago',
    'UT': 'America/Denver',     'VA': 'America/New_York',   'VT': 'America/New_York',
    'WA': 'America/Los_Angeles','WI': 'America/Chicago',    'WV': 'America/New_York',
    'WY': 'America/Denver'
};

/**
 * Extracts the state abbreviation from an area string like "Seattle WA"
 * and returns the IANA timezone. Defaults to Eastern if unknown.
 */
function getLeadTimezone(area) {
    if (!area) return 'America/New_York';
    var parts = area.trim().split(/\s+/);
    var state = parts[parts.length - 1].toUpperCase();
    return STATE_TIMEZONES[state] || 'America/New_York';
}

/**
 * Checks if the current time is within the send window:
 *   - 10 AM – 12 PM in the lead's local timezone
 *   - Not Sunday
 */
function isInSendWindow(timezone) {
    var now = new Date();
    var localHour = parseInt(Utilities.formatDate(now, timezone, 'H'), 10);
    var localDay = parseInt(Utilities.formatDate(now, timezone, 'u'), 10); // 1=Mon … 7=Sun

    if (localDay === 7) return false; // No Sundays
    return localHour >= 10 && localHour < 12;
}

// ============================================================
// FOLLOW-UP MESSAGE TEMPLATES
// ============================================================

/** Text 2 — Day 3+, gentle follow-up. */
function buildFollowUp1(bizName, demoUrl) {
    return 'Hey, just following up \u2014 the demo site I built for ' + bizName +
        ' is still live: ' + demoUrl +
        '\nHappy to answer any questions.' +
        '\n- Jeremy';
}

/** Text 3 — Day 7+, final touch. */
function buildFollowUp2(bizName, demoUrl) {
    return 'Last note from me \u2014 the sample site for ' + bizName +
        ' will stay up for a few more days. If a website isn\'t a priority right now, no worries. ' +
        'If it is, just reply and I\'ll get it set up.' +
        '\n- Jeremy';
}

// ============================================================
// SMS COMPLIANCE LOG
// ============================================================

/**
 * Logs every SMS event (sent or received) to the SMS_Log sheet.
 * Required for TCPA compliance — never delete this sheet.
 */
function logSmsCompliance(ss, phone, direction, body, messageSid) {
    try {
        var sheet = ss.getSheetByName('SMS_Log');
        if (!sheet) {
            sheet = ss.insertSheet('SMS_Log');
            sheet.getRange(1, 1, 1, 5).setValues([
                ['Timestamp', 'Direction', 'Phone', 'Body', 'MessageSid']
            ]);
            sheet.getRange(1, 1, 1, 5)
                .setFontWeight('bold')
                .setBackground('#1a1a2e')
                .setFontColor('#ffffff');
        }
        sheet.appendRow([
            new Date().toISOString(),
            direction,
            phone,
            (body || '').substring(0, 500),
            messageSid || ''
        ]);
    } catch (e) {
        console.error('logSmsCompliance error:', e);
    }
}

/**
 * Opens the spreadsheet using SHEET_ID with DEFAULT_SHEET_ID fallback.
 * Shared by webhook and follow-up code.
 */
function openLeadsSpreadsheet() {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('SHEET_ID') || DEFAULT_SHEET_ID;
    return SpreadsheetApp.openById(sheetId);
}

// ============================================================
// DAILY FOLLOW-UP RUNNER
// ============================================================

/**
 * Main follow-up function — scans all leads, sends follow-ups where timing + status match.
 * Designed to run hourly via time-driven trigger.
 * Only sends during the 10 AM – 12 PM local window on non-Sundays.
 */
function runDailyFollowUps() {
    var config = getConfig();
    if (!config || !config.twilioEnabled) {
        console.log('Follow-ups skipped: config missing or Twilio not enabled');
        return;
    }

    var ss = openLeadsSpreadsheet();
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) {
        console.log('Follow-ups skipped: no Leads sheet');
        return;
    }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var col = {};
    ['Status', 'Business_Name', 'Target_Phone', 'Live_Pages_URL', 'Area',
     'Sent_Date', 'Channel', 'Texts_Sent', 'Last_Text_Date'].forEach(function (h) {
        col[h] = headers.indexOf(h);
    });

    if (col.Status === -1 || col.Sent_Date === -1 || col.Target_Phone === -1) {
        console.error('Follow-ups skipped: required columns missing (Status/Sent_Date/Target_Phone)');
        return;
    }

    var now = new Date();
    var sentCount = 0;
    var completedCount = 0;
    var skippedTz = 0;

    for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var status = (row[col.Status] || '').toString().trim();
        var channel = col.Channel !== -1 ? (row[col.Channel] || 'sms').toString().trim().toLowerCase() : 'sms';

        // Only process SMS leads in follow-up-eligible statuses
        if (channel !== 'sms') continue;
        if (status !== 'Sent' && status !== 'Follow_Up_1' && status !== 'Follow_Up_2') continue;

        var phone = (row[col.Target_Phone] || '').toString().trim();
        var bizName = (row[col.Business_Name] || '').toString().trim();
        var demoUrl = (row[col.Live_Pages_URL] || '').toString().trim();
        var area = col.Area !== -1 ? (row[col.Area] || '').toString().trim() : '';
        var sentDateStr = (row[col.Sent_Date] || '').toString().trim();
        var textsSent = col.Texts_Sent !== -1 ? (parseInt(row[col.Texts_Sent], 10) || 1) : 1;

        if (!phone || !sentDateStr) continue;

        var sentDate = new Date(sentDateStr);
        if (isNaN(sentDate.getTime())) continue;

        var daysSinceSent = (now - sentDate) / (1000 * 60 * 60 * 24);
        var rowNum = i + 1;
        var timezone = getLeadTimezone(area);

        // Mark completed leads regardless of time window
        if (status === 'Follow_Up_2' && daysSinceSent >= 14) {
            sheet.getRange(rowNum, col.Status + 1).setValue('Completed');
            console.log('Completed: ' + bizName + ' (row ' + rowNum + ') \u2014 14+ days, no reply');
            completedCount++;
            continue;
        }

        // Check time window BEFORE deciding what to send
        if (!isInSendWindow(timezone)) {
            skippedTz++;
            continue;
        }

        var smsBody = null;
        var newStatus = null;

        if (status === 'Sent' && daysSinceSent >= 3 && textsSent < 2) {
            smsBody = buildFollowUp1(bizName, demoUrl);
            newStatus = 'Follow_Up_1';
        } else if (status === 'Follow_Up_1' && daysSinceSent >= 7 && textsSent < 3) {
            smsBody = buildFollowUp2(bizName, demoUrl);
            newStatus = 'Follow_Up_2';
        }

        if (!smsBody || !newStatus) continue;

        // Send the follow-up SMS
        var result = sendSmsMessage(phone, smsBody, config);
        if (result.success) {
            sheet.getRange(rowNum, col.Status + 1).setValue(newStatus);
            if (col.Texts_Sent !== -1) {
                sheet.getRange(rowNum, col.Texts_Sent + 1).setValue(textsSent + 1);
            }
            if (col.Last_Text_Date !== -1) {
                sheet.getRange(rowNum, col.Last_Text_Date + 1).setValue(now.toISOString());
            }

            logSmsCompliance(ss, phone, 'sent', smsBody, '');
            console.log(newStatus + ' sent to ' + bizName + ' (' + phone + ') \u2014 row ' + rowNum);
            sentCount++;
        } else {
            console.error('Follow-up failed for row ' + rowNum + ' (' + bizName + '): ' + result.error);
        }

        Utilities.sleep(5000); // Pace between sends
    }

    console.log('Follow-up run complete: sent=' + sentCount + ' completed=' + completedCount + ' skippedTz=' + skippedTz);
}

// ============================================================
// DASHBOARD
// ============================================================

/**
 * Builds or refreshes a "Dashboard" sheet with lead status summary,
 * replies received, and opt-outs.
 */
function refreshDashboard() {
    var ss = openLeadsSpreadsheet();
    var leadsSheet = ss.getSheetByName('Leads');
    if (!leadsSheet) return;

    var data = leadsSheet.getDataRange().getValues();
    var headers = data[0];
    var col = {};
    ['Status', 'Business_Name', 'Target_Phone', 'Area', 'Niche',
     'Sent_Date', 'First_Reply', 'Texts_Sent'].forEach(function (h) {
        col[h] = headers.indexOf(h);
    });

    // Count statuses and collect details
    var statusCounts = {};
    var replies = [];
    var optOuts = [];
    var total = 0;

    for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var status = (row[col.Status] || '').toString().trim();
        if (!status) continue;
        total++;
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        var name = col.Business_Name !== -1 ? (row[col.Business_Name] || '').toString() : '';
        var phone = col.Target_Phone !== -1 ? (row[col.Target_Phone] || '').toString() : '';

        if (status === 'Replied' && col.First_Reply !== -1) {
            replies.push({
                name: name,
                phone: phone,
                reply: (row[col.First_Reply] || '').toString(),
                date: col.Sent_Date !== -1 ? (row[col.Sent_Date] || '').toString() : ''
            });
        }
        if (status === 'Stopped') {
            optOuts.push({
                name: name,
                phone: phone,
                date: col.Sent_Date !== -1 ? (row[col.Sent_Date] || '').toString() : ''
            });
        }
    }

    // Create or clear Dashboard sheet
    var dash = ss.getSheetByName('Dashboard');
    if (dash) {
        dash.clear();
    } else {
        dash = ss.insertSheet('Dashboard');
    }

    var r = 1;

    // Title
    dash.getRange(r, 1).setValue('WebsiteForge Dashboard').setFontSize(16).setFontWeight('bold');
    r++;
    dash.getRange(r, 1).setValue('Last refreshed: ' + new Date().toISOString()).setFontColor('#6b7280').setFontSize(10);
    r += 2;

    // Summary
    dash.getRange(r, 1).setValue('LEAD SUMMARY').setFontWeight('bold').setFontSize(12);
    r++;
    dash.getRange(r, 1, 1, 2).setValues([['Total Leads Contacted', total]]);
    dash.getRange(r, 1).setFontWeight('bold');
    r += 1;

    // Status breakdown
    var statusOrder = ['Review Needed', 'Sent', 'Follow_Up_1', 'Follow_Up_2',
                       'Replied', 'Stopped', 'Completed', 'Intake Received'];
    for (var s = 0; s < statusOrder.length; s++) {
        var st = statusOrder[s];
        var count = statusCounts[st] || 0;
        if (count > 0 || st === 'Replied' || st === 'Stopped') {
            dash.getRange(r, 1, 1, 2).setValues([[st, count]]);
            r++;
        }
    }
    // Any unlisted statuses
    for (var key in statusCounts) {
        if (statusOrder.indexOf(key) === -1) {
            dash.getRange(r, 1, 1, 2).setValues([[key, statusCounts[key]]]);
            r++;
        }
    }
    r++;

    // Replies section
    dash.getRange(r, 1).setValue('REPLIES RECEIVED').setFontWeight('bold').setFontSize(12);
    r++;
    if (replies.length === 0) {
        dash.getRange(r, 1).setValue('No replies yet').setFontColor('#6b7280');
        r++;
    } else {
        dash.getRange(r, 1, 1, 4).setValues([['Business', 'Phone', 'Reply', 'Sent Date']]);
        dash.getRange(r, 1, 1, 4).setFontWeight('bold').setBackground('#f3f4f6');
        r++;
        for (var ri = 0; ri < replies.length; ri++) {
            dash.getRange(r, 1, 1, 4).setValues([[
                replies[ri].name, replies[ri].phone, replies[ri].reply, replies[ri].date
            ]]);
            r++;
        }
    }
    r++;

    // Opt-outs section
    dash.getRange(r, 1).setValue('OPT-OUTS (STOP)').setFontWeight('bold').setFontSize(12);
    r++;
    if (optOuts.length === 0) {
        dash.getRange(r, 1).setValue('No opt-outs').setFontColor('#6b7280');
        r++;
    } else {
        dash.getRange(r, 1, 1, 3).setValues([['Business', 'Phone', 'Sent Date']]);
        dash.getRange(r, 1, 1, 3).setFontWeight('bold').setBackground('#fef2f2');
        r++;
        for (var oi = 0; oi < optOuts.length; oi++) {
            dash.getRange(r, 1, 1, 3).setValues([[
                optOuts[oi].name, optOuts[oi].phone, optOuts[oi].date
            ]]);
            r++;
        }
    }

    dash.autoResizeColumns(1, 4);

    try {
        ss.toast('Dashboard refreshed!', 'Dashboard', 5);
    } catch (e) { /* not interactive */ }
}

// ============================================================
// TRIGGER MANAGEMENT
// ============================================================

/**
 * Installs an hourly trigger for runDailyFollowUps.
 * Run once from the menu — the trigger persists until removed.
 */
function installFollowUpTrigger() {
    removeFollowUpTrigger(); // clear any existing

    ScriptApp.newTrigger('runDailyFollowUps')
        .timeBased()
        .everyHours(1)
        .create();

    console.log('Follow-up trigger installed (runs every hour)');
    try {
        SpreadsheetApp.getActiveSpreadsheet().toast(
            'Follow-up trigger installed! Checks every hour, sends during 10 AM \u2013 12 PM local time only.',
            'Trigger Active', 10
        );
    } catch (e) { /* not interactive */ }
}

/**
 * Removes all follow-up triggers.
 */
function removeFollowUpTrigger() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === 'runDailyFollowUps') {
            ScriptApp.deleteTrigger(triggers[i]);
            console.log('Removed existing follow-up trigger');
        }
    }
}

// ============================================================
// DIAGNOSTIC
// ============================================================

/**
 * Run manually to verify the webhook can find leads and update statuses.
 * Does NOT send any SMS — just tests the sheet lookup logic.
 */
function testWebhookLookup() {
    var ss = openLeadsSpreadsheet();
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) {
        console.log('TEST FAIL: No Leads sheet found');
        SpreadsheetApp.getActiveSpreadsheet().toast('FAIL: No Leads sheet', 'Test', 10);
        return;
    }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var phoneCol = headers.indexOf('Target_Phone');
    var statusCol = headers.indexOf('Status');
    var nameCol = headers.indexOf('Business_Name');

    console.log('TEST: Found Leads sheet with ' + (data.length - 1) + ' data rows');
    console.log('TEST: Target_Phone col = ' + phoneCol + ', Status col = ' + statusCol);

    if (phoneCol === -1) {
        console.log('TEST FAIL: Target_Phone column not found. Headers: ' + headers.join(', '));
        return;
    }

    var sentCount = 0;
    for (var i = 1; i < data.length; i++) {
        var phone = (data[i][phoneCol] || '').toString();
        var status = (data[i][statusCol] || '').toString();
        var name = nameCol !== -1 ? (data[i][nameCol] || '').toString() : '';
        var digits = phone.replace(/[^0-9]/g, '');
        if (digits.length >= 10) {
            var masked = digits.substring(0, 3) + '***' + digits.substring(digits.length - 4);
            console.log('  Row ' + (i + 1) + ': ' + name + ' | ' + masked + ' | Status: ' + status);
            if (status === 'Sent') sentCount++;
        }
    }

    console.log('TEST: ' + sentCount + ' leads with Status=Sent');
    console.log('TEST: If STOPs are not updating, check:');
    console.log('  1. Web app redeployed to latest version?');
    console.log('  2. SHEET_ID in Script Properties matches this sheet? (fallback: ' + DEFAULT_SHEET_ID + ')');

    try {
        SpreadsheetApp.getActiveSpreadsheet().toast(
            'Check Execution Log for details. ' + sentCount + ' leads with Status=Sent.',
            'Webhook Test', 10
        );
    } catch (e) { /* not interactive */ }
}
