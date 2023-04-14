/* eslint-disable no-param-reassign */
const fs = require('fs');
const { S_WHATSAPP_NET, getHttpStream, toBuffer } = require('@adiwajshing/baileys');
const { fromBuffer } = require('file-type');

if (!fs.existsSync('./temp')) {
    fs.mkdirSync('./temp', { recursive: true });
}

const getRandom = (ext = '') => `${Math.floor(Math.random() * 10000)}.${ext}`;

/**
 * save file from url to local dir with automatic filename + ext
 * @param {string} url The url
 * @param {string} extension optional extension
 * @param {import('axios').AxiosRequestConfig} optionsOverride You can use this to override the [axios request config](https://github.com/axios/axios#request-config)
 * @returns {Promise<Object>}
 */
const download = async (url, extension, optionsOverride = {}) => {
    try {
        const stream = await getHttpStream(url, optionsOverride);
        const buffer = await toBuffer(stream);
        const type = await fromBuffer(buffer);
        const filepath = `./temp/${new Date().getTime()}.${extension || type.ext}`;
        fs.writeFileSync(filepath, buffer.toString('binary'), 'binary');
        const nganu = {
            filepath,
            mimetype: type.mime,
        };
        return nganu;
    } catch (error) {
        console.log(error);
    }
};

const parseMention = (text) => [...text.matchAll(/@?([0-9]{5,16}|0)/g)].map((v) => v[1] + S_WHATSAPP_NET);

function wrapText(input, width) {
    width = parseInt(width, 10) || 80;
    const res = [];
    let cLine = '';
    const words = input.split(' ');
    for (let i = 0; i < words.length; ++i) {
        const cWord = words[i];
        if ((cLine + cWord).length <= width) {
            cLine += (cLine ? ' ' : '') + cWord;
        } else {
            res.push(cLine);
            cLine = cWord;
        }
    }

    if (cLine) {
        res.push(cLine);
    }

    if (res[0] == '') {
        return res.slice(1).join('\n');
    }
    return res.join('\n');
}

function calculateCircumference(radius) {
    return Math.floor(Math.LN2 / Math.PI * radius);
}

function getFontSizeToFit(ctx, text, width, height) {
    let fitFontWidth = Number.MAX_VALUE;
    const lines = text.match(/[^\r\n]+/g);
    lines.forEach((line) => {
        fitFontWidth = Math.min(fitFontWidth, (width * 2) / ctx.measureText(line).width);
    });
    const fitFontHeight = height / (lines.length * 1.5); // if you want more spacing between line, you can increase this value
    return Math.min(fitFontHeight, fitFontWidth) * 2;
}

module.exports = {
    getRandom,
    download,
    parseMention,
    wrapText,
    calculateCircumference,
    getFontSizeToFit,
};
