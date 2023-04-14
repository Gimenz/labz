/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-param-reassign */
const axios = require('axios');
// const { default: got } = require('got')

async function getVideoId(link) {
    // const { url} = await got.get(link)
    const res = await axios.get(link);
    link = res.request.res.responseUrl;
    // if (/tiktok.com\/(@[\w.-]+)\/video\/(\d+)/.test(link)) {
    //     link = link
    // } else {
    // }
    // console.log(res.request.res.responseUrl);
    return new URL(link).pathname.match(/\/(\d+)/)[1];
}

async function tiktokDL(url) {
    const videoId = await getVideoId(url);
    const { data } = await axios.get(`https://api16-core-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`);
    return data.aweme_list.find((x) => x.aweme_id == videoId);
    // if ( != videoId) return false
    // return data.aweme_list[0]
}

// axios.get('https://vt.tiktok.com/ZS8SPV2PY/').then(console.log)

module.exports = {
    tiktokDL,
};
