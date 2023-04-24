const fs = require('fs');
const { google } = require('googleapis');
const mime = require('mime-types');
const path = require('path');
const express = require('express');
const { delay } = require('@adiwajshing/baileys');

const app = express();

const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/drive.apps.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.metadata',
];

const CREDENTIALS_PATH = `${__dirname}/token/credentials.json`;
const TOKEN_PATH = `${__dirname}/token/token.json`;

if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('credentials file are required, get it on here => https://console.cloud.google.com/apis/');
}
if (!fs.existsSync(TOKEN_PATH)) {
    // console.log('token file are required, get it on here => https://developers.google.com/oauthplayground/');
    fs.writeFileSync(TOKEN_PATH, JSON.stringify('{}'), 'utf-8');
}

const token = fs.readFileSync(TOKEN_PATH, 'utf-8');

// In-memory store for tokens
class MemoryTokenStore {
    constructor(rootRef) {
        this.rootRef = rootRef || 'tokens';
        this.tokenStore = {};
        this.tokenStore[this.rootRef] = {};
    }

    async saveTokenSync(tokenKey, tokenValue) {
        // Simulate a slow save
        console.log('Saving to database...');
        await delay(3000);
        this.tokenStore[this.rootRef][tokenKey] = tokenValue;
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(this.tokenStore[this.rootRef][tokenKey], null, 2));
        console.log('Saved to database');
        return tokenValue;
    }

    async loadTokenSync(tokenKey) {
        // Simulate a fast load
        await delay(100);
        return this.tokenStore[this.rootRef][tokenKey];
    }
}

/** ***********************************
 * Init
 ************************************ */
const OAUTH_CALLBACK_ROUTE = 'oauth2callback';
const TOKEN_KEY = 'accessToken';
const TOKEN_STORE = new MemoryTokenStore();

// Load the app secret
console.log('Loading Client Secret...');
const clientSecretJson = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
console.log('Client Secret Loaded.');

let accessToken;
let oauth2Client = new google.auth.OAuth2(
    clientSecretJson.installed.client_id,
    clientSecretJson.installed.client_secret,
    `http://localhost:8080/${OAUTH_CALLBACK_ROUTE}`,
);

/** ***********************************
 * Middleware for accessToken check
 ************************************ */
const tokenChecker = async (req, res, next) => {
    console.log('Checking auth token...');

    if (!oauth2Client) {
        console.log('Creating new oauth2Client...');
        oauth2Client = new google.auth.OAuth2(
            clientSecretJson.installed.client_id,
            clientSecretJson.installed.client_secret,
            `http://${req.get('host')}/${OAUTH_CALLBACK_ROUTE}`,
        );
    }
    if (!accessToken) {
        console.log('No access token in scope, attempting to load...');
        accessToken = await TOKEN_STORE.loadTokenSync(TOKEN_KEY);

        const max_expiry = Date.now() + 60000;

        // Listen for refresh tokens
        oauth2Client.on('tokens', async (tokens) => {
            console.log('in oauth2Client.on(...) about to save a token');
            if (tokens.refresh_token) {
                await TOKEN_STORE.saveTokenSync(TOKEN_KEY, tokens);
            } else {
                console.error(`Expected a refresh_token, but none was found: ${JSON.stringify(tokens, null, 2)}`);
            }
        });

        if (accessToken && ((accessToken.refresh_token) || (accessToken.expiry_date && accessToken.expiry_date >= max_expiry))) {
            console.log('Token is not expired or will refresh');
            await oauth2Client.setCredentials(accessToken);
            next();
        } else {
            // Just for debugging/info
            if (accessToken && accessToken.expiry_date < max_expiry) {
                console.log('Access Token expired, redirecting to oauth flow');
            } else {
                console.log('No access token found in database, redirecting to oauth flow');
            }

            // Generate + redirect to OAuth2 consent form URL
            const redirectUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
                state: req.path,
                prompt: 'consent',
            });

            res.redirect(redirectUrl);
        }
    } else {
        console.log('Using token in scope');
        next();
    }
};

// The root path will do a token check
app.get('/', tokenChecker, async (req, res) => {
    res.status(200).send('OK');
});

// The test path will also do a token check
app.get('/test', tokenChecker, async (req, res) => {
    res.status(200).send('OK');
});

app.get(`/${OAUTH_CALLBACK_ROUTE}`, async (req, res) => {
    try {
        const code = req.query.code;

        // Do I need to await this??
        const { tokens } = await oauth2Client.getToken(code);

        console.log(`in /${OAUTH_CALLBACK_ROUTE} about to set token credentials`);

        // Setting credentials will trigger the on('tokens') event (?)
        // Do I need to await this??
        await oauth2Client.setCredentials(tokens);

        res.redirect(req.query.state);
    } catch (err) {
        console.error(err);
        res.status(500).send('Something went wrong; check the logs.');
    }
});

const port = process.env.PORT || 8080;

app.listen(port, () => {
    console.log('Oauth Test listening on port', port);
});

// After acquiring an access_token, you may want to check on the audience, expiration,
// or original scopes requested.  You can do that with the `getTokenInfo` method.
// oAuth2Client.getTokenInfo(
//     oAuth2Client.credentials.access_token
// )
//     .then(res => {
//         console.log(res);
//     })

// const authUrl = oAuth2Client.generateAuthUrl({
//     access_type: 'offline',
//     scope: SCOPES,
//     prompt: 'consent',
// });

// console.log(authUrl);

// const getTokenWithRefresh = (secret, refreshToken) => {

//     let oauth2Client = new google.auth.OAuth2(
//         secret.client_id,
//         secret.client_secret,
//         secret.redirect_uris
//     )

//     oauth2Client.credentials.refresh_token = refreshToken

//     oauth2Client.refreshAccessToken((error, tokens) => {
//         if (!error) {
//             console.log(tokens);
//             // persist tokens.access_token
//             // persist tokens.refresh_token (for future refreshs)
//         }
//         console.log(error);
//     })

// }

// console.log(getTokenWithRefresh(credentials.installed, token.refresh_token));

oauth2Client.setCredentials(token);

/**
 * check if folder is exists in drice
 * @param {string} name folder name
 * @returns
 */
const checkFolderExists = async (name) => {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const check = await drive.files.list({ q: `mimeType='application/vnd.google-apps.folder' and name='${name}'  and trashed=false `, spaces: 'drive' });
    if (check.data.files.length) {
        return { exists: true, id: check.data.files[0].id };
    }
    return { exists: false, id: '' };
};

/**
 * create folder in google drive
 * @param {string} name folder name
 * @param {string} parentId folder id
 * @returns
 */
const createFolder = async (name, parentId) => {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const body = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
        body.parents = [parentId];
    }
    const response = await drive.files.create({
        requestBody: body,
        fields: 'id',
    });
    return response.data;
};

/**
 * upload file to google drive
 * @param {string} filePath path of the file
 * @param {string} parentId folder id
 * @returns
 */
const uploadFile = async (filePath, parentId) => {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const body = {
        name: path.basename(filePath),
        parents: [parentId], // Optional and make sure to replace with your folder id.
    };
    const media = {
        body: fs.createReadStream(filePath),
        mimeType: mime.lookup(filePath),
    };
    return drive.files.create({
        requestBody: body,
        fields: 'id',
        media,
    })
        .then((res) => {
            console.log(res.data);
            return res;
        });
};

const driveStats = async () => {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    return drive.about.get({ fields: '*' }).then((res) => res.data.storageQuota);
};

module.exports = {
    checkFolderExists,
    createFolder,
    uploadFile,
    driveStats,
};
