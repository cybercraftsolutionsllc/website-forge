/**
 * GitHub.js — GitHub API helper for deploying demo sites
 * 
 * Handles the GET-for-SHA + PUT flow to deploy HTML files
 * to the demos/ directory in the website-forge repo.
 */

/**
 * Deploys an HTML file to GitHub Pages via the Contents API.
 * 
 * @param {string} slug — kebab-case business identifier (used as folder name)
 * @param {string} htmlContent — Full HTML string to deploy
 * @param {Object} config — From getConfig()
 * @returns {{ success: boolean, liveUrl: string, error: string|null }}
 */
function deployToGitHubPages(slug, htmlContent, config) {
    var filePath = 'demos/' + slug + '/index.html';
    var apiUrl = 'https://api.github.com/repos/' + config.org + '/' + config.repo + '/contents/' + filePath;

    try {
        // Step 1: Check if file already exists (to get SHA for updates)
        var sha = null;
        var checkRes = UrlFetchApp.fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + config.githubPat,
                'Accept': 'application/vnd.github.v3+json'
            },
            muteHttpExceptions: true
        });

        if (checkRes.getResponseCode() === 200) {
            sha = JSON.parse(checkRes.getContentText()).sha;
            console.log('File exists, will update (SHA: ' + sha + ')');
        } else if (checkRes.getResponseCode() === 404) {
            console.log('File does not exist, will create.');
        } else {
            var errBody = checkRes.getContentText();
            console.error('GitHub GET error (' + checkRes.getResponseCode() + '):', errBody);
            return {
                success: false,
                liveUrl: '',
                error: 'GitHub GET failed (' + checkRes.getResponseCode() + '): ' + errBody.substring(0, 200)
            };
        }

        // Step 2: Create or update the file
        var payload = {
            message: 'Add demo for ' + slug,
            content: Utilities.base64Encode(htmlContent, Utilities.Charset.UTF_8),
            branch: config.branch
        };

        if (sha) {
            payload.sha = sha;
            payload.message = 'Update demo for ' + slug;
        }

        var putRes = UrlFetchApp.fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + config.githubPat,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        var putCode = putRes.getResponseCode();
        if (putCode !== 200 && putCode !== 201) {
            var putErr = putRes.getContentText();
            console.error('GitHub PUT error (' + putCode + '):', putErr);
            return {
                success: false,
                liveUrl: '',
                error: 'GitHub PUT failed (' + putCode + '): ' + putErr.substring(0, 200)
            };
        }

        var liveUrl = 'https://' + config.org + '.github.io/' + config.repo + '/demos/' + slug + '/';
        console.log('Deployed successfully: ' + liveUrl);

        return {
            success: true,
            liveUrl: liveUrl,
            error: null
        };

    } catch (e) {
        console.error('GitHub deploy error:', e);
        return {
            success: false,
            liveUrl: '',
            error: 'GitHub deploy threw: ' + e.toString()
        };
    }
}
