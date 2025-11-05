const { AuthenticationClient, ResponseType } = require('@aps_sdk/authentication');
const { APS_CLIENT_ID, APS_CALLBACK_URL, INTERNAL_TOKEN_SCOPES } = require('../../config.js');

const authenticationClient = new AuthenticationClient();

function getAuthorizationUrl() {
    return authenticationClient.authorize(APS_CLIENT_ID, ResponseType.Code, APS_CALLBACK_URL, INTERNAL_TOKEN_SCOPES);
}

async function getUserProfile(accessToken) {
    const resp = await authenticationClient.getUserInfo(accessToken);
    return resp;
}

module.exports = {
    getAuthorizationUrl,
    getUserProfile
};