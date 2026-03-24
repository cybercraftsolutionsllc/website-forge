/**
 * Places.js — Google Places API integration + Pexels image search + DomScan domain checks
 * 
 * Replaces LLM-based business discovery with real, verified data from Google.
 * The LLM is ONLY used for copywriting (services list + domain suggestion).
 * 
 * New Script Properties required:
 *   PLACES_API_KEY   — Google Places API key
 *   DOMSCAN_API_KEY  — DomScan API key (free at domscan.net, for domain availability + pricing)
 *   PEXELS_API_KEY   — Pexels API key (free at pexels.com/api, for relevant images)
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

    var res;
    try {
        res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    } catch (e) {
        if (e.message && e.message.indexOf('Bandwidth quota exceeded') !== -1) {
            console.error('GAS bandwidth quota exceeded — stopping to avoid further failures');
            return { businesses: [], error: 'QUOTA_EXCEEDED' };
        }
        throw e;
    }
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

    var res;
    try {
        res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    } catch (e) {
        if (e.message && e.message.indexOf('Bandwidth quota exceeded') !== -1) {
            console.error('GAS bandwidth quota exceeded on Place Details — aborting');
            return null;
        }
        throw e;
    }
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
    var statusCol = headers.indexOf('Status');
    var placeIdCol = headers.indexOf('Place_ID');

    if (nameCol === -1 || phoneCol === -1) return [];

    var leads = [];
    for (var i = 1; i < data.length; i++) {
        leads.push({
            name: (data[i][nameCol] || '').toString(),
            phone: normalizePhone((data[i][phoneCol] || '').toString()),
            status: statusCol !== -1 ? (data[i][statusCol] || '').toString() : '',
            placeId: placeIdCol !== -1 ? (data[i][placeIdCol] || '').toString() : ''
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

        // Dedup check against existing leads (phone, name, or Place ID)
        var normalizedPhone = normalizePhone(phone);
        var dupReason = '';
        var isDup = existingLeads.some(function (lead) {
            if (lead.phone === normalizedPhone) {
                dupReason = lead.status === 'Stopped'
                    ? 'phone match — STOPPED (opted out)'
                    : 'phone match';
                return true;
            }
            if (lead.name.toLowerCase() === details.name.toLowerCase()) {
                dupReason = 'name match';
                return true;
            }
            if (lead.placeId && lead.placeId === biz.place_id) {
                dupReason = 'Place ID match';
                return true;
            }
            return false;
        });
        if (isDup) {
            console.log('Skipping (duplicate — ' + dupReason + '): ' + details.name);
            continue;
        }

        // We have a verified lead!
        console.log('✅ Verified lead found: ' + details.name + ' | ' + phone + ' | ' + city);
        return {
            data: {
                business_name: details.name,
                target_phone: phone,
                target_email: 'None found', // Places rarely has email — SMS is our primary channel
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
 * @returns {{ services: string, suggested_domains: string[], error: string|null }}
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
        '2. Suggest FIVE different domain names for this business.',
        '   Mix styles: businessname+city, niche+city, abbreviation, catchy brandable, etc.',
        '   Keep them short and memorable. Use only lowercase letters, numbers, and hyphens. All .com.',
        '   List them comma-separated inside the DOMAIN tag.',
        '',
        'CRITICAL: Output ONLY the XML tags below. No markdown. No explanation.',
        '',
        '<SERVICES>Service1, Service2, Service3, Service4, Service5</SERVICES>',
        '<DOMAIN>domain1.com, domain2.com, domain3.com, domain4.com, domain5.com</DOMAIN>'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.7, maxTokens: 500 });

    if (result.error) {
        console.error('Copy generation LLM failed: ' + result.error);
        return { services: '', suggested_domains: [], error: result.error };
    }

    // Parse services and domains from XML tags
    var copyData = extractCopyData(result.text);
    console.log('LLM copy generated — services: ' + copyData.services + ' | domains: ' + copyData.suggested_domains.join(', '));

    return {
        services: copyData.services,
        suggested_domains: copyData.suggested_domains,
        error: null
    };
}

/**
 * Re-query LLM for more domain suggestions when the first batch is all taken.
 * 
 * @param {Object} biz — business data
 * @param {string[]} takenDomains — domains that were already checked and taken
 * @param {Object} config
 * @returns {string[]} — new domain suggestions (may be empty on LLM failure)
 */
function generateMoreDomains(biz, takenDomains, config) {
    var prompt = [
        'You are a domain name specialist.',
        '',
        'Business: ' + biz.business_name,
        'Niche: ' + biz.niche,
        'Location: ' + biz.area,
        '',
        'These domain names were ALL TAKEN:',
        takenDomains.join(', '),
        '',
        'Suggest 5 COMPLETELY DIFFERENT domain names that are more likely to be available.',
        'Use creative approaches: uncommon abbreviations, unique word combos, area codes,',
        'neighborhood names, slang, or brandable made-up words. All .com.',
        'Use only lowercase letters, numbers, and hyphens.',
        '',
        'CRITICAL: Output ONLY the XML tag below. No markdown. No explanation.',
        '',
        '<DOMAIN>domain1.com, domain2.com, domain3.com, domain4.com, domain5.com</DOMAIN>'
    ].join('\n');

    var result = callLLM(prompt, config, { temperature: 0.9, maxTokens: 300 });
    if (result.error) {
        console.error('Domain re-query LLM failed: ' + result.error);
        return [];
    }

    var copyData = extractCopyData(result.text);
    var newDomains = copyData.suggested_domains.filter(function (d) {
        return takenDomains.indexOf(d) === -1; // Exclude any repeats
    });

    console.log('LLM domain re-query — ' + newDomains.length + ' new suggestions: ' + newDomains.join(', '));
    return newDomains;
}

// ============================================================
// DOMAIN AVAILABILITY + PRICING (DomScan API)
// ============================================================

/**
 * Check domain availability and get real pricing via DomScan API.
 * Falls back to DNS check if DomScan key isn't configured.
 * 
 * @param {string} domain — e.g. "mybusiness.com"
 * @param {Object} config — may contain config.domscanApiKey
 * @returns {{ available: boolean, price: string, buyUrl: string, error: string|null }}
 */
function checkDomain(domain, config) {
    if (!domain) return { available: false, price: '', buyUrl: '', error: 'No domain provided' };

    // Clean the domain
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();
    if (!domain || domain.indexOf('.') === -1) return { available: false, price: '', buyUrl: '', error: 'Invalid domain' };

    // Try DomScan API (availability + pricing)
    if (config.domscanApiKey) {
        return checkDomainDomScan(domain, config);
    }

    // Fallback: DNS check only (no pricing)
    console.log('DOMSCAN_API_KEY not configured — falling back to DNS check for ' + domain);
    var dnsAvailable = checkDomainDNS(domain);
    return {
        available: dnsAvailable,
        price: '',
        buyUrl: '',
        error: null
    };
}

/**
 * DomScan API — returns domain availability + real registrar pricing.
 * Free: 10,000 credits/month at domscan.net
 * 
 * @param {string} domain — full domain like "mybusiness.com"
 * @param {Object} config — must have config.domscanApiKey
 * @returns {{ available: boolean, price: string, error: string|null }}
 */
function checkDomainDomScan(domain, config) {
    try {
        // Split domain into name and TLD
        var dotIndex = domain.indexOf('.');
        var name = domain.substring(0, dotIndex);
        var tld = domain.substring(dotIndex + 1); // e.g. "com"

        // Step 1: Check availability
        var statusUrl = 'https://domscan.net/v1/status?name=' + encodeURIComponent(name) +
            '&tlds=' + encodeURIComponent(tld) + '&prefer_cache=0';

        console.log('DomScan availability: ' + domain);
        var res = UrlFetchApp.fetch(statusUrl, {
            method: 'GET',
            headers: {
                'X-API-Key': config.domscanApiKey,
                'Accept': 'application/json'
            },
            muteHttpExceptions: true
        });

        var code = res.getResponseCode();
        var responseBody = res.getContentText();

        if (code !== 200) {
            console.error('DomScan status error (' + code + '): ' + responseBody.substring(0, 300));
            var dnsResult = checkDomainDNS(domain);
            return { available: dnsResult, price: '', buyUrl: '', error: 'DomScan returned ' + code };
        }

        // Log full response for debugging
        console.log('DomScan raw response: ' + responseBody.substring(0, 500));

        var data = JSON.parse(responseBody);
        var results = data.results || [];
        var domainResult = null;
        for (var i = 0; i < results.length; i++) {
            if (results[i].domain === domain) {
                domainResult = results[i];
                break;
            }
        }

        if (!domainResult) {
            console.log('DomScan: no matching result for ' + domain + ' in response');
            var dnsFallback = checkDomainDNS(domain);
            return { available: dnsFallback, price: '', buyUrl: '', error: null };
        }

        var available = domainResult.available === true;

        // Cross-check: if DomScan says taken, verify with DNS
        // DomScan can be wrong (stale RDAP cache, aftermarket listings, etc.)
        if (!available) {
            var dnsCheck = checkDomainDNS(domain);
            if (dnsCheck) {
                console.log('DomScan says taken but DNS says NXDOMAIN — treating as AVAILABLE: ' + domain);
                available = true;
            }
        }

        console.log('DomScan: ' + domain + ' — ' + (available ? 'AVAILABLE' : 'taken'));

        // Step 2: Get pricing if available
        var priceStr = '';
        var buyUrl = '';
        if (available) {
            var pricing = getDomainPricing(tld, domain, config);
            priceStr = pricing.price;
            buyUrl = pricing.buyUrl;
        }

        return { available: available, price: priceStr, buyUrl: buyUrl, error: null };
    } catch (e) {
        console.error('DomScan error for ' + domain + ': ' + e);
        var dnsFb = checkDomainDNS(domain);
        return { available: dnsFb, price: '', buyUrl: '', error: e.toString() };
    }
}

/**
 * Get real domain pricing from DomScan's pricing endpoint.
 * Returns the cheapest registration price across registrars + a purchase URL.
 * 
 * @param {string} tld — e.g. "com"
 * @param {string} domain — full domain like "mybusiness.com"
 * @param {Object} config
 * @returns {{ price: string, buyUrl: string }}
 */
function getDomainPricing(tld, domain, config) {
    // Known standard prices as fallback (updated periodically)
    var FALLBACK_PRICES = {
        'com': '$15.00/yr (est.)',
        'net': '$12.99/yr (est.)',
        'org': '$9.99/yr (est.)',
        'co': '$11.99/yr (est.)',
        'io': '$29.99/yr (est.)'
    };

    // Registrar → purchase URL templates (DOMAIN is replaced with actual domain)
    var BUY_URLS = {
        'cloudflare': 'https://www.cloudflare.com/products/registrar/',
        'porkbun': 'https://porkbun.com/checkout/search?q=DOMAIN',
        'namecheap': 'https://www.namecheap.com/domains/registration/results/?domain=DOMAIN',
        'godaddy': 'https://www.godaddy.com/domainsearch/find?domainToCheck=DOMAIN',
        'google': 'https://domains.google.com/registrar/search?searchTerm=DOMAIN',
        'squarespace': 'https://domains.squarespace.com/?channel=pbr&subchannel=go&campaign=SQS_Domains_Core_NB_US_EN&subcampaign=(pbr:go:SQS_Domains_Core_NB_US_EN)',
        'dynadot': 'https://www.dynadot.com/domain/search?domain=DOMAIN',
        'spaceship': 'https://www.spaceship.com/domain/search/?query=DOMAIN',
        'hover': 'https://www.hover.com/domains/results?q=DOMAIN'
    };

    function getBuyUrl(registrarKey) {
        if (!registrarKey || !domain) return '';
        var key = registrarKey.toLowerCase().replace(/[^a-z]/g, '');
        // Match against known registrars
        for (var name in BUY_URLS) {
            if (key.indexOf(name) > -1) {
                return BUY_URLS[name].replace(/DOMAIN/g, domain);
            }
        }
        // Generic fallback: Google search for "register DOMAIN"
        return 'https://www.google.com/search?q=register+' + encodeURIComponent(domain);
    }

    try {
        var url = 'https://domscan.net/v1/prices/tld/' + encodeURIComponent(tld);
        var res = UrlFetchApp.fetch(url, {
            method: 'GET',
            headers: {
                'X-API-Key': config.domscanApiKey,
                'Accept': 'application/json'
            },
            muteHttpExceptions: true
        });

        var code = res.getResponseCode();
        var body = res.getContentText();
        console.log('DomScan pricing response (' + code + '): ' + body.substring(0, 500));

        if (code !== 200) {
            console.warn('DomScan pricing returned ' + code + ' — using fallback');
            return { price: FALLBACK_PRICES[tld] || '', buyUrl: '' };
        }

        var data = JSON.parse(body);

        // Response format: { success: true, data: { tld: "com", prices: [...] } }
        var prices = (data.data && data.data.prices) || data.prices || data.registrars || [];

        if (!Array.isArray(prices) || prices.length === 0) {
            console.warn('DomScan pricing returned empty/invalid prices — using fallback');
            return { price: FALLBACK_PRICES[tld] || '', buyUrl: '' };
        }

        // Find cheapest registration price
        // DomScan uses "register" for new registration cost
        var cheapest = prices[0];
        for (var i = 1; i < prices.length; i++) {
            var regPrice = prices[i].register || prices[i].registration || prices[i].price || 999;
            var cheapPrice = cheapest.register || cheapest.registration || cheapest.price || 999;
            if (regPrice < cheapPrice) {
                cheapest = prices[i];
            }
        }

        var regCost = cheapest.register || cheapest.registration || cheapest.price;
        var registrarId = cheapest.registrar || cheapest.name || '';
        var registrarName = cheapest.registrarName || registrarId || 'registrar';

        if (!regCost) {
            console.warn('DomScan pricing: no registration cost found — using fallback');
            return { price: FALLBACK_PRICES[tld] || '', buyUrl: '' };
        }

        var priceStr = '$' + parseFloat(regCost).toFixed(2) + '/yr (' + registrarName + ')';
        var buyLink = getBuyUrl(registrarId);
        console.log('DomScan pricing for .' + tld + ': ' + priceStr + ' → ' + buyLink);
        return { price: priceStr, buyUrl: buyLink };
    } catch (e) {
        console.error('DomScan pricing error: ' + e + ' — using fallback');
        return { price: FALLBACK_PRICES[tld] || '', buyUrl: '' };
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
// PEXELS IMAGE SEARCH
// ============================================================

/**
 * Search Pexels for images relevant to the business niche and services.
 * Returns pre-fetched image URLs that are GUARANTEED to be relevant.
 * 
 * @param {string} niche — e.g. "gutter cleaning"
 * @param {string[]} servicesList — e.g. ["Gutter Cleaning", "Gutter Installation"]
 * @param {Object} config — must have config.pexelsApiKey
 * @returns {{ hero: string, services: string[], about: string }}
 */
function searchPexelsImages(niche, servicesList, config) {
    var defaultImg = 'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop';
    var result = {
        hero: defaultImg,
        services: [],
        about: defaultImg
    };

    if (!config.pexelsApiKey) {
        console.warn('PEXELS_API_KEY not set — images will not be niche-relevant');
        for (var i = 0; i < servicesList.length; i++) {
            result.services.push(defaultImg);
        }
        return result;
    }

    // Helper: query Pexels and return the first photo URL at given size
    function pexelsSearch(query, w, h, page) {
        try {
            var url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) +
                '&per_page=5&page=' + (page || 1) + '&orientation=landscape';
            var res = UrlFetchApp.fetch(url, {
                method: 'GET',
                headers: { 'Authorization': config.pexelsApiKey },
                muteHttpExceptions: true
            });

            if (res.getResponseCode() !== 200) {
                console.error('Pexels search failed for "' + query + '": ' + res.getResponseCode());
                return null;
            }

            var data = JSON.parse(res.getContentText());
            if (!data.photos || data.photos.length === 0) {
                console.log('Pexels: no results for "' + query + '"');
                return null;
            }

            // Pick a random photo from results for variety
            var photo = data.photos[Math.floor(Math.random() * data.photos.length)];
            var imgUrl = photo.src.landscape || photo.src.large || photo.src.original;
            // Append size params if using pexels CDN
            if (imgUrl.indexOf('pexels.com') > -1 && w && h) {
                imgUrl = imgUrl.split('?')[0] + '?auto=compress&cs=tinysrgb&w=' + w + '&h=' + h + '&fit=crop';
            }
            console.log('Pexels: "' + query + '" → ' + imgUrl.substring(0, 80) + '...');
            return imgUrl;
        } catch (e) {
            console.error('Pexels search error for "' + query + '": ' + e);
            return null;
        }
    }

    // Tiered search: try specific query first, then broaden
    function findImage(query, w, h) {
        // Try the full query
        var img = pexelsSearch(query, w, h, 1);
        if (img) return img;

        // Broaden: try just the first word
        var firstWord = query.split(' ')[0];
        if (firstWord !== query) {
            img = pexelsSearch(firstWord, w, h, 1);
            if (img) return img;
        }

        // Last resort: try the niche
        img = pexelsSearch(niche, w, h, 2);
        if (img) return img;

        return defaultImg;
    }

    // Hero image: niche + "professional"
    result.hero = findImage(niche + ' professional', 1920, 1080);

    // Service images: each service gets its own search
    var usedUrls = {};
    usedUrls[result.hero] = true;

    for (var s = 0; s < servicesList.length; s++) {
        var serviceQuery = servicesList[s] + ' ' + niche.split(' ')[0];
        var svcImg = findImage(serviceQuery, 800, 600);

        // Avoid duplicates across services
        if (usedUrls[svcImg] && servicesList.length > 1) {
            // Try with page 2
            var altImg = pexelsSearch(serviceQuery, 800, 600, 2);
            if (altImg && !usedUrls[altImg]) {
                svcImg = altImg;
            }
        }
        usedUrls[svcImg] = true;
        result.services.push(svcImg);
    }

    // About section: team/worker photo
    result.about = findImage(niche + ' worker team', 800, 600);

    console.log('Pexels images fetched: hero=1, services=' + result.services.length + ', about=1');
    return result;
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
