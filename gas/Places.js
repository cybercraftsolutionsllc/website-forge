/**
 * Places.js — Google Places API integration for verified lead discovery
 * 
 * Replaces LLM-based business discovery with real, verified data from Google.
 * The LLM is ONLY used for copywriting (services list + domain suggestion).
 * 
 * New Script Properties required:
 *   PLACES_API_KEY — Google Places API key
 */

// ============================================================
// NICHE + CITY ROTATION
// ============================================================
var NICHES = [
    'plumber', 'roofer', 'landscaper', 'auto repair', 'dry cleaner',
    'electrician', 'HVAC', 'pest control', 'locksmith', 'tree service',
    'pressure washing', 'carpet cleaning', 'garage door repair', 'fencing contractor',
    'gutter cleaning', 'handyman', 'towing service', 'appliance repair'
];

var CITIES = [
    'New York NY', 'Los Angeles CA', 'Chicago IL', 'Houston TX',
    'Phoenix AZ', 'Philadelphia PA', 'San Antonio TX', 'San Diego CA',
    'Dallas TX', 'Jacksonville FL', 'Austin TX', 'Fort Worth TX',
    'San Jose CA', 'Columbus OH', 'Charlotte NC', 'Indianapolis IN',
    'San Francisco CA', 'Seattle WA', 'Denver CO', 'Oklahoma City OK',
    'Nashville TN', 'Washington DC', 'El Paso TX', 'Las Vegas NV',
    'Boston MA', 'Detroit MI', 'Portland OR', 'Louisville KY',
    'Memphis TN', 'Baltimore MD', 'Milwaukee WI', 'Albuquerque NM',
    'Tucson AZ', 'Fresno CA', 'Sacramento CA', 'Mesa AZ',
    'Atlanta GA', 'Kansas City MO', 'Colorado Springs CO', 'Omaha NE',
    'Raleigh NC', 'Miami FL', 'Virginia Beach VA', 'Long Beach CA',
    'Oakland CA', 'Minneapolis MN', 'Bakersfield CA', 'Tulsa OK',
    'Tampa FL', 'Arlington TX', 'Wichita KS', 'Aurora CO',
    'New Orleans LA', 'Cleveland OH', 'Honolulu HI', 'Anaheim CA',
    'Henderson NV', 'Orlando FL', 'Lexington KY', 'Stockton CA',
    'Riverside CA', 'Corpus Christi TX', 'Irvine CA', 'Cincinnati OH',
    'Santa Ana CA', 'Newark NJ', 'St Paul MN', 'Pittsburgh PA',
    'Greensboro NC', 'Durham NC', 'Lincoln NE', 'Jersey City NJ',
    'Plano TX', 'Anchorage AK', 'North Las Vegas NV', 'St Louis MO',
    'Madison WI', 'Chandler AZ', 'Gilbert AZ', 'Reno NV',
    'Buffalo NY', 'Chula Vista CA', 'Fort Wayne IN', 'Lubbock TX',
    'Toledo OH', 'St Petersburg FL', 'Laredo TX', 'Irving TX',
    'Chesapeake VA', 'Glendale AZ', 'Winston-Salem NC',
    'Port St Lucie FL', 'Scottsdale AZ', 'Garland TX', 'Boise ID',
    'Norfolk VA', 'Spokane WA', 'Richmond VA', 'Fremont CA',
    'Huntsville AL', 'Tacoma WA', 'San Bernardino CA', 'Modesto CA',
    'Fontana CA', 'Des Moines IA', 'Moreno Valley CA',
    'Santa Clarita CA', 'Fayetteville NC', 'Birmingham AL',
    'Oxnard CA', 'Rochester NY', 'Knoxville TN', 'Akron OH',
    'Tempe AZ', 'Brownsville TX', 'Salt Lake City UT',
    'Tallahassee FL', 'Cape Coral FL', 'McKinney TX',
    'Grand Rapids MI', 'Shreveport LA', 'Overland Park KS',
    'Sioux Falls SD', 'Providence RI', 'Chattanooga TN',
    'Frisco TX', 'Little Rock AR', 'Baton Rouge LA', 'Augusta GA'
];

/**
 * Pick a random item from an array.
 */
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================
// GOOGLE PLACES API
// ============================================================

/**
 * Search Google Places Text Search for businesses in a niche + city.
 * 
 * @param {string} niche
 * @param {string} city
 * @param {Object} config — must contain config.placesApiKey
 * @returns {{ businesses: Array, error: string|null }}
 */
function searchGooglePlaces(niche, city, config) {
    var query = niche + ' in ' + city;
    var url = 'https://maps.googleapis.com/maps/api/place/textsearch/json'
        + '?query=' + encodeURIComponent(query)
        + '&key=' + config.placesApiKey;

    console.log('Places Text Search: ' + query);

    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = res.getResponseCode();
    var data = JSON.parse(res.getContentText());

    if (code !== 200 || data.status !== 'OK' || !data.results || data.results.length === 0) {
        console.log('Places search failed: status=' + (data.status || code) + ', results=' + (data.results ? data.results.length : 0));
        return { businesses: [], error: 'No results for "' + query + '" (status: ' + (data.status || code) + ')' };
    }

    console.log('Places search returned ' + data.results.length + ' results for "' + query + '"');
    return { businesses: data.results, error: null };
}

/**
 * Get detailed information for a specific place (phone, website, address, etc).
 * 
 * @param {string} placeId — Google Place ID
 * @param {Object} config — must contain config.placesApiKey
 * @returns {Object|null} Place details or null on failure
 */
function getPlaceDetails(placeId, config) {
    var fields = 'name,formatted_phone_number,international_phone_number,website,formatted_address,types,rating,user_ratings_total,business_status';
    var url = 'https://maps.googleapis.com/maps/api/place/details/json'
        + '?place_id=' + placeId
        + '&fields=' + fields
        + '&key=' + config.placesApiKey;

    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = res.getResponseCode();
    var data = JSON.parse(res.getContentText());

    if (code !== 200 || data.status !== 'OK' || !data.result) {
        console.log('Place Details failed for ' + placeId + ': ' + (data.status || code));
        return null;
    }

    return data.result;
}

// ============================================================
// LEAD DISCOVERY
// ============================================================

/**
 * Read existing leads from the sheet for dedup checks.
 * Returns an array of { name, phone } objects.
 * 
 * @param {Sheet} sheet — the Leads sheet
 * @returns {Array<{ name: string, phone: string }>}
 */
function getExistingLeads(sheet) {
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // header only

    var headers = data[0];
    var nameCol = headers.indexOf('Business_Name');
    var phoneCol = headers.indexOf('Target_Phone');

    if (nameCol === -1 || phoneCol === -1) return [];

    var leads = [];
    for (var i = 1; i < data.length; i++) {
        leads.push({
            name: (data[i][nameCol] || '').toString(),
            phone: normalizePhone((data[i][phoneCol] || '').toString())
        });
    }
    return leads;
}

/**
 * Core lead discovery: search Places, get details, filter for good leads.
 * Returns the FIRST qualifying business from the search results.
 * 
 * Qualifying = has phone + no website + operational + not a duplicate.
 * 
 * @param {string} niche
 * @param {string} city
 * @param {Object} config
 * @param {Array} existingLeads — from getExistingLeads()
 * @returns {{ data: Object|null, error: string|null }}
 */
function findLeadFromPlaces(niche, city, config, existingLeads) {
    var search = searchGooglePlaces(niche, city, config);
    if (search.error) return { data: null, error: search.error };

    var detailsChecked = 0;
    var MAX_DETAILS = 10; // budget ~10 Place Details calls per run

    for (var i = 0; i < search.businesses.length && detailsChecked < MAX_DETAILS; i++) {
        var biz = search.businesses[i];

        // Skip closed businesses
        if (biz.business_status && biz.business_status !== 'OPERATIONAL') {
            console.log('Skipping (not operational): ' + biz.name);
            continue;
        }

        // Get full details
        detailsChecked++;
        var details = getPlaceDetails(biz.place_id, config);
        if (!details) continue;

        // Must have a phone number
        var phone = details.formatted_phone_number || details.international_phone_number;
        if (!phone || !isValidPhone(phone)) {
            console.log('Skipping (no valid phone): ' + details.name);
            continue;
        }

        // Check for missing website — strict mode: only businesses with NO site
        var hasWebsite = details.website && details.website.length > 0;
        if (hasWebsite) {
            console.log('Skipping (has website): ' + details.name + ' → ' + details.website);
            continue;
        }

        // Dedup check against existing leads
        var normalizedPhone = normalizePhone(phone);
        var isDup = existingLeads.some(function (lead) {
            return lead.phone === normalizedPhone ||
                lead.name.toLowerCase() === details.name.toLowerCase();
        });
        if (isDup) {
            console.log('Skipping (duplicate): ' + details.name);
            continue;
        }

        // We have a verified lead!
        console.log('✅ Verified lead found: ' + details.name + ' | ' + phone + ' | ' + city);
        return {
            data: {
                business_name: details.name,
                target_phone: phone,
                target_email: '', // Places rarely has email — SMS is our primary channel
                area: city,
                niche: niche,
                address: details.formatted_address || '',
                rating: details.rating || null,
                review_count: details.user_ratings_total || 0,
                place_id: biz.place_id,
                channel: 'sms',
                suggested_domain: '', // Generated by LLM later
                domain_cost: ''
            },
            error: null
        };
    }

    return { data: null, error: 'No qualifying leads for "' + niche + '" in "' + city + '" (checked ' + detailsChecked + ' details)' };
}

// ============================================================
// LLM COPY GENERATION (services + domain ONLY — no business data)
// ============================================================

/**
 * Uses the LLM ONLY for copywriting tasks. The LLM never generates
 * business names, phone numbers, or addresses — those come from Google Places.
 * 
 * @param {Object} biz — verified business data from findLeadFromPlaces()
 * @param {Object} config
 * @returns {{ services: string, suggested_domain: string, error: string|null }}
 */
function generateCopyForLead(biz, config) {
    var prompt = [
        'You are a copywriter for a web design agency.',
        '',
        'I have a verified lead:',
        '  Business: ' + biz.business_name,
        '  Niche: ' + biz.niche,
        '  Location: ' + biz.area,
        '  Address: ' + (biz.address || 'N/A'),
        '',
        'Tasks:',
        '1. List 4-6 specific services this type of ' + biz.niche + ' business would typically offer.',
        '   These must be real, specific services. Example for plumber: "Drain Cleaning", "Water Heater Repair", etc.',
        '',
        '2. Suggest ONE domain name for this business (e.g., businessname + city + .com).',
        '   Keep it short and memorable. Use only lowercase letters, numbers, and hyphens.',
        '',
        'CRITICAL: Output ONLY the XML tags below. No markdown. No explanation.',
        '',
        '<SERVICES>Service1, Service2, Service3, Service4, Service5</SERVICES>',
        '<DOMAIN>suggesteddomain.com</DOMAIN>'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.5, maxTokens: 500 });

    if (result.error) {
        console.error('Copy generation LLM failed: ' + result.error);
        return { services: '', suggested_domain: '', error: result.error };
    }

    // Parse services and domain from XML tags
    var copyData = extractCopyData(result.text);
    console.log('LLM copy generated — services: ' + copyData.services + ' | domain: ' + copyData.suggested_domain);

    return {
        services: copyData.services,
        suggested_domain: copyData.suggested_domain,
        error: null
    };
}

// ============================================================
// DOMAIN AVAILABILITY + PRICING
// ============================================================

/**
 * Check domain availability and get real pricing via GoDaddy API.
 * Falls back to DNS check if GoDaddy keys aren't configured.
 * 
 * @param {string} domain — e.g. "mybusiness.com"
 * @param {Object} config — may contain config.godaddyKey and config.godaddySecret
 * @returns {{ available: boolean, price: string, error: string|null }}
 */
function checkDomain(domain, config) {
    if (!domain) return { available: false, price: '', error: 'No domain provided' };

    // Clean the domain
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();
    if (!domain || domain.indexOf('.') === -1) return { available: false, price: '', error: 'Invalid domain' };

    // Try GoDaddy API first (real pricing)
    if (config.godaddyKey && config.godaddySecret) {
        return checkDomainGoDaddy(domain, config);
    }

    // Fallback: DNS check only (no pricing without GoDaddy)
    console.log('GoDaddy API not configured — falling back to DNS check for ' + domain);
    var dnsAvailable = checkDomainDNS(domain);
    return {
        available: dnsAvailable,
        price: '',
        error: null
    };
}

/**
 * GoDaddy Domain Availability API — returns availability + real pricing.
 * 
 * @param {string} domain
 * @param {Object} config — must have config.godaddyKey and config.godaddySecret
 * @returns {{ available: boolean, price: string, error: string|null }}
 */
function checkDomainGoDaddy(domain, config) {
    try {
        var url = 'https://api.godaddy.com/v1/domains/available?domain=' + encodeURIComponent(domain) + '&checkType=FAST';
        var authHeader = 'sso-key ' + config.godaddyKey + ':' + config.godaddySecret;

        console.log('GoDaddy request: GET ' + url);
        console.log('GoDaddy auth: sso-key ' + config.godaddyKey.substring(0, 8) + '...:' + config.godaddySecret.substring(0, 4) + '...');

        var res = UrlFetchApp.fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            },
            muteHttpExceptions: true
        });

        var code = res.getResponseCode();
        var responseBody = res.getContentText();
        if (code !== 200) {
            console.error('GoDaddy API error (' + code + '): ' + responseBody.substring(0, 500));
            // Fall back to DNS (no pricing)
            var dnsResult = checkDomainDNS(domain);
            return { available: dnsResult, price: '', error: 'GoDaddy API returned ' + code };
        }

        var data = JSON.parse(res.getContentText());
        var available = data.available === true;

        // Price comes in micro-units (1/1,000,000 of currency)
        // e.g. 11990000 = $11.99/year
        var priceStr = '';
        if (available && data.price) {
            var dollars = (data.price / 1000000).toFixed(2);
            var currency = data.currency || 'USD';
            priceStr = '$' + dollars + '/' + (data.period || 1) + 'yr';
            console.log('GoDaddy: ' + domain + ' — available, ' + priceStr + ' (' + currency + ')');
        } else if (available) {
            priceStr = 'Available (price not returned)';
            console.log('GoDaddy: ' + domain + ' — available, no price data');
        } else {
            console.log('GoDaddy: ' + domain + ' — NOT available');
        }

        return { available: available, price: priceStr, error: null };
    } catch (e) {
        console.error('GoDaddy API error for ' + domain + ': ' + e);
        var dnsFallback = checkDomainDNS(domain);
        return { available: dnsFallback, price: '', error: e.toString() };
    }
}

/**
 * DNS-based domain availability check via Google DoH (fallback).
 * No pricing — just checks if the domain has DNS records.
 * 
 * @param {string} domain
 * @returns {boolean} true if domain appears available
 */
function checkDomainDNS(domain) {
    try {
        var url = 'https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=A';
        var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        var data = JSON.parse(res.getContentText());

        // Status 3 = NXDOMAIN (domain doesn't exist) → likely available
        if (data.Status === 3) {
            console.log('DNS: domain available (NXDOMAIN): ' + domain);
            return true;
        }

        if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
            console.log('DNS: domain taken (has records): ' + domain);
            return false;
        }

        console.log('DNS: domain status ambiguous (status=' + data.Status + '): ' + domain);
        return false;
    } catch (e) {
        console.error('DNS check failed for ' + domain + ': ' + e);
        return false;
    }
}

// ============================================================
// TWILIO PHONE VALIDATION (safety net)
// ============================================================

/**
 * Validate a phone number using Twilio Lookup API.
 * This is a safety net — numbers from Google Places should already be valid.
 * 
 * Returns smsCapable: true for mobile/voip, false for landline.
 * Landlines CANNOT receive SMS — the pipeline should skip SMS for these.
 * 
 * @param {string} phone — raw phone string
 * @param {Object} config — must have twilioSid, twilioToken, twilioEnabled
 * @returns {{ valid: boolean, smsCapable: boolean, type: string, error: string|null }}
 */
function validatePhoneWithTwilio(phone, config) {
    if (!config.twilioEnabled) {
        console.log('Twilio not configured — skipping phone validation');
        return { valid: true, smsCapable: true, type: 'unknown', error: null }; // assume SMS-capable if we can't check
    }

    var normalized = normalizePhone(phone);

    try {
        var url = 'https://lookups.twilio.com/v1/PhoneNumbers/' + encodeURIComponent(normalized) + '?Type=carrier';
        var authHeader = 'Basic ' + Utilities.base64Encode(config.twilioSid + ':' + config.twilioToken);

        var res = UrlFetchApp.fetch(url, {
            method: 'GET',
            headers: { 'Authorization': authHeader },
            muteHttpExceptions: true
        });

        var code = res.getResponseCode();
        if (code !== 200) {
            console.error('Twilio Lookup failed (' + code + '): ' + res.getContentText().substring(0, 200));
            return { valid: false, smsCapable: false, type: 'unknown', error: 'Twilio returned ' + code };
        }

        var data = JSON.parse(res.getContentText());
        var carrierType = (data.carrier && data.carrier.type) || 'unknown';
        console.log('Twilio Lookup: ' + normalized + ' → type=' + carrierType);

        // Valid if it's a real phone number (landline, mobile, or voip)
        var isValid = carrierType === 'mobile' || carrierType === 'landline' || carrierType === 'voip';

        // SMS only works on mobile and voip — landlines CANNOT receive text messages
        var canSms = carrierType === 'mobile' || carrierType === 'voip';
        if (!canSms && isValid) {
            console.warn('⚠️ Phone is a LANDLINE — SMS will NOT be deliverable: ' + normalized);
        }

        return { valid: isValid, smsCapable: canSms, type: carrierType, error: null };
    } catch (e) {
        console.error('Twilio Lookup error: ' + e);
        return { valid: false, smsCapable: false, type: 'unknown', error: e.toString() };
    }
}

// ============================================================
// LEAD MANAGEMENT
// ============================================================

/**
 * Clear all lead rows from the Leads sheet (keeps headers).
 * Added to the WebsiteForge menu for clean-slate runs.
 */
function clearAllLeads() {
    var config = getConfig();
    if (!config) return;

    var ss = SpreadsheetApp.openById(config.sheetId);
    var sheet = ss.getSheetByName('Leads');

    if (!sheet) {
        ss.toast('No Leads tab found.', '❌', 5);
        return;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
        ss.toast('No leads to clear.', 'ℹ️', 5);
        return;
    }

    // Delete data rows (keep header row 1)
    sheet.deleteRows(2, lastRow - 1);
    console.log('Cleared ' + (lastRow - 1) + ' lead rows.');
    ss.toast('Cleared ' + (lastRow - 1) + ' leads.', '🧹 Clean Slate', 5);
}
