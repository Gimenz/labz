/* eslint-disable no-param-reassign */
/**
 * Author  : Gimenz
 * Name    : nganu
 * Version : 1.0
 * Update  : 27 Januari 2022
 *
 * If you are a reliable programmer or the best developer, please don't change anything.
 * If you want to be appreciated by others, then don't change anything in this script.
 * Please respect me for making this tool from the beginning.
 */
require('dotenv').config();
const { fromBuffer } = require('file-type');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const { Image } = require('node-webpmux');
const { randomBytes } = require('crypto');
const { registerFont, createCanvas } = require('canvas');
const { default: canvasTxt } = require('canvas-txt');
const { removeBackgroundFromImageBase64 } = require('remove.bg');
const { EmojiAPI } = require('emoji-api');
const { isUrl, getBuffer, fetchAPI } = require('./index');
const { Exif } = require('./exif');
const { wrapText, calculateCircumference, getFontSizeToFit } = require('../lib/function');
const EzGif = new (require('../lib/ezgif'))();

const emo = new EmojiAPI();
// ffmpeg.setFfmpegPath("C:/ffmpeg/bin/ffmpeg.exe");

let cropStyle = [
    'rounded',
    'circle',
    'nobg',
    'negate',
    'pixelate',
    'greyscale',
    'grayscale',
    'love',
];

const colourspace = {
    'b-w': 'b-w',
    bw: 'b-w',
    cmyk: 'cmyk',
    srgb: 'srgb',
};

const cropType = {
    rounded: Buffer.from('<svg><rect x="0" y="0" width="450" height="450" rx="50" ry="50"/></svg>'),
    circle: Buffer.from('<svg height="485" width="485"><circle cx="242.5" cy="242.5" r="242.5" fill="#3a4458"/></svg>'),
};

cropStyle = cropStyle.concat(Object.keys(colourspace));

// some part of this code is copied from:  https://github.com/AlenSaito1/wa-sticker-formatter/ <- awesome library
class Sticker {
    /**
     * let set the sticker metadata
     * @typedef {Object} IStickerMetadata
     * @property {string} packname sticker pack name
     * @property {string} author sticker author
     * @property {string} packId sticker pack id
     * @property {string} categories sticker emoji categories
     */

    /**
     * Build an WebP WAsticker with exif metadata
     * @param {string|Buffer} data File path, url or Buffer of the image/video
     * @param {IStickerMetadata} metadata let set the sticker metadata
     * @param {string} crop crop style [just for image], can be circle | rounded
     */
    constructor(data, metadata, crop = undefined) {
        this.data = data;
        this.packname = metadata.packname;
        this.author = metadata.author;
        this.packId = metadata.packId;
        this.categories = metadata.categories;
        this.crop = cropStyle.includes(crop) ? crop : undefined;
    }

    /**
     * process image
     * @param {Buffer} data
     * @returns {Promise<Buffer>} WebP Buffer
     */
    processImage = async (data) => {
        const input = this.crop === 'pixelate'
            ? await sharp(data).resize(20, null, { kernel: 'nearest' }).toBuffer()
            : this.crop == 'love'
                ? await this.cropLove(data)
                : data;
        return new Promise((resolve, reject) => {
            sharp(input)
                .negate(this.crop === 'negate')
                .greyscale(/gr(e|a)yscale/.test(this.crop))
                .resize(512, 512, {
                    fit: 'contain',
                    background: {
                        r: 0, g: 0, b: 0, alpha: 0,
                    },
                })
                .toColourspace(Object.keys(colourspace).includes(this.crop) ? colourspace[this.crop] : 'srgb')
                .toFormat('webp')
                .toBuffer()
                .then(resolve)
                .catch(reject);
        });
    };

    static cropLove = async (input) => {
        const overlay = `${__dirname}/src/love.png`;
        const image = await sharp(input).resize(1080, 1080).toBuffer();
        const sharpImage = sharp(image);
        const size = await sharpImage.metadata();
        const overlaySize = await sharp(overlay).metadata();

        const blurred = await sharpImage
            .resize({ width: Math.floor(size.height * 0.70) })
            .toBuffer()
            .then((resizedBuffer) => sharpImage
                .resize(
                    {
                        height: Math.floor((size.height) * (Math.LOG10E + Math.SQRT1_2)),
                        width: Math.floor((size.width) * 0.98),
                        fit: 'cover',
                    },
                )
                .blur(8)
                .composite([{
                    input: resizedBuffer,
                    gravity: 'center',
                }])
            // .toFile('blurred.png')
                .toBuffer());

        const cropped = sharp(blurred)
            .resize({ height: Math.floor((size.height + overlaySize.height) / Math.LN10), width: Math.floor((size.width + overlaySize.width) / Math.LN10) })
            .composite([{ input: overlay, blend: 'dest-in' }])
            .toFormat('png')
            .toBuffer();
        // .toFile('blurred.png')

        return cropped;
    };

    /**
     * rotate an image
     * @param {Buffer} input buffer image
     * @param {90|180|270|"flip"|"flop"} deg max degree is 360
     * @returns {Promise<Buffer>}
     */
    static rotate = async (input, deg) => {
        if (!isNaN(deg) && deg > 360) return 'max degrees is 360';
        return new Promise((resolve, reject) => {
            sharp(input)
                .flip(deg === 'flip')
                .flop(deg === 'flop')
                .rotate(/fl(o|i)p/.test(deg) ? 0 : parseInt(deg, 10))
                .toFormat('png')
                .toBuffer()
                .then(resolve)
                .catch(reject);
        });
    };

    /**
     * crop image
     * @returns {Promise<Buffer>} WebP Buffer
     */
    cropImage = (input) => new Promise((resolve, reject) => {
        sharp(input)
            .toFormat('webp')
            .resize(512, 512)
            .composite([{
                input: cropType[this.crop],
                blend: 'dest-in',
                cutout: true,
            }])
            .toBuffer()
            .then(resolve)
            .catch(reject);
    });

    // i think did not work yet, bcz problem at libvips installation
    static convertGif = (input) => new Promise((resolve, reject) => {
        sharp(input)
            .gif()
            .toBuffer()
            .then(resolve)
            .catch(reject);
    });

    /**
     * convert video to WebP WASticker format
     * @param {Buffer} data video to be converted
     * @returns {Promise<Buffer} WebP Buffer
     */
    static processAnimated = async (data) => {
        try {
            const input = `${__dirname}/temp/video_${randomBytes(3).toString('hex')}.mp4`;
            const output = `${__dirname}/temp/${randomBytes(3).toString('hex')}.webp`;
            fs.writeFileSync(input, data.toString('binary'), 'binary');
            const file = await new Promise((resolve) => {
                ffmpeg(input)
                    .inputOptions(['-y', '-t', '20'])
                    .complexFilter(['scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1'])
                    .outputOptions(['-qscale', '50', '-fs', '1M', '-vcodec', 'libwebp', '-preset', 'default', '-loop', '0', '-an', '-vsync', '0'])
                    .format('webp')
                    .save(output)
                    .on('end', () => resolve(output));
            });
            const buffer = fs.readFileSync(file);
            [input, output].forEach((file) => fs.unlinkSync(file));
            return buffer;
        } catch (error) {
            console.log(error);
        }
    };

    /**
     * creates meme with custom image
     * @param {string} top top text
     * @param {string} bottom bottom text
     * @param {string} backgroundUrl background image url
     * @returns {Promise<string>} url of image
     */
    static memeGenerator = async (top, bottom, backgroundUrl) => {
        const res = await fetchAPI('https://api.memegen.link', '/images/custom', {
            method: 'POST',
            data: {
                background: backgroundUrl,
                style: 'default',
                text_lines: [
                    top,
                    bottom,
                ],
                extension: 'png',
                redirect: false,
            },
        });
        return res.url;
    };

    /**
     * convert emoji into image
     * @param {string} emoji
     * @param {string} vendor
     * @returns
     */
    static emoji = async (emoji, vendor = 'apple') => {
        const res = await emo.get(emoji);
        return res.images.find((x) => x.vendor.toLowerCase().includes(vendor.toLowerCase()));
    };

    /**
     * remove the background of and image. do note! that this function is only for remove the bg
     *
     * remove.bg apikey, you can get it from -> https://www.remove.bg/api
     * also, you can use many apikey, place it on .env and separated by comma, eg: apikey1, apikey2
     * @param {Buffer} input image buffer
     * @returns
     */
    static removeBG = async (input) => {
        try {
            if (process.env.removeBG == '') return 'remove.bg api-key did not set yet';
            const arrayKu = process.env.removeBG.split(',');
            const response = await removeBackgroundFromImageBase64({
                base64img: input.toString('base64'),
                apiKey: arrayKu[Math.floor(Math.random() * arrayKu.length)],
                size: 'auto',
                type: 'auto',
            });
            return Buffer.from(response.base64img, 'base64');
        } catch (error) {
            return error;
        }
    };

    static ttp = (text) => {
        registerFont('../src/font/ObelixProBIt-cyr.ttf', { family: 'pg' });
        const canvas = createCanvas(512, 512);
        const ctx = canvas.getContext('2d');

        // alpha bg
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        text = wrapText(text, calculateCircumference(text.length));
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        canvasTxt.font = 'pg';
        canvasTxt.align = 'center';
        canvasTxt.strokeWidth = 1.5;
        canvasTxt.lineHeight = null;
        canvasTxt.fontSize = getFontSizeToFit(ctx, text, canvas.width, canvas.height);
        canvasTxt.drawText(ctx, text, 0, 0, 512, 512);
        return canvas.toBuffer();
    };

    /**
     * create animated text
     * @param {string} text
     * @returns {Promise<Buffer>}
     */
    static attp = async (text) => {
        const data = await fetchAPI('https://xteam.xyz', `/attp?file&text=${text}`, {
            responseType: 'arraybuffer',
        });

        return data;
    };

    /**
     * remove image background and convert it into WASticker WebP
     * @param {Buffer} input
     * @returns
     */
    processNoBG = async (input) => {
        try {
            const buffer = await Sticker.removeBG(await this._parse(input));
            return this.processImage(buffer);
        } catch (error) {
            return error;
        }
    };

    /**
     * mboh radong
     * @returns {Promise<Buffer} WebP Buffer
     */
    static cropVideo = async (data) => {
        try {
            const input = `${__dirname}/temp/video_${randomBytes(3).toString('hex')}.mp4`;
            const output = `${__dirname}/temp/${randomBytes(3).toString('hex')}.webp`;
            fs.writeFileSync(input, data.toString('binary'), 'binary');
            const file = await new Promise((resolve) => {
                ffmpeg(input)
                    .inputOptions(['-y', '-t', '20'])
                    .outputOptions([
                        '-vcodec',
                        'libwebp',
                        '-vf',
                        // eslint-disable-next-line no-useless-escape
                        'crop=w=\'min(min(iw\,ih)\,500)\':h=\'min(min(iw\,ih)\,500)\',scale=500:500,setsar=1,fps=15',
                        '-loop',
                        '0',
                        '-preset',
                        'default',
                        '-an',
                        '-vsync',
                        '0',
                        '-s',
                        '512:512',
                    ])
                    .format('webp')
                    .save(output)
                    .on('end', () => resolve(output));
            });
            const buffer = fs.readFileSync(file);
            [input, output].forEach((file) => fs.unlinkSync(file));
            return buffer;
        } catch (error) {
            console.log(error);
        }
    };

    /**
     * parse this image to Buffer
     * @param {Buffer|string} input url | filepath | Buffer
     * @returns {Promise<Buffer>}
     */
    _parse = async (input = this.data) => (Buffer.isBuffer(input)
        ? input
        : isUrl(input)
            ? (await getBuffer(input)).buffer
            : fs.existsSync(input)
                ? fs.readFileSync(input)
                : input);

    /**
     * add metadata to webp buffer
     * @param {Buffer} input webp buffer
     * @returns {Promise<Buffer>}
     */
    addMetadata = async (input) => {
        const data = input || this.data;
        const exif = new Exif({
            packname: this.packname, author: this.author, packId: this.packId, categories: this.categories,
        }).create();
        const img = new Image();
        await img.load(data);
        img.exif = exif;
        const result = await img.save(null);
        return result;
    };

    /**
     * get mimetype from Buffer
     * @param {Buffer} input
     * @returns
     */
    _getMimeType = async (input) => {
        const type = await fromBuffer(input);
        if (!type) {
            if (typeof this.data === 'string') return 'image/svg+xml';
            throw new Error('Invalid file type');
        }
        return type.mime;
    };

    static _isAnimated = (buffer) => {
        const ANIM = [0x41, 0x4E, 0x49, 0x4D];
        for (let i = 0; i < buffer.length; i++) {
            for (let j = 0; j < ANIM.length; j++) {
                if (buffer[i + j] !== ANIM[j]) {
                    break;
                }
            }
            if (j === ANIM.length) {
                return true;
            }
        }
        return false;
    };

    /**
     * create WASticker with metadata
     * @returns {Promise<Buffer>} WebP Buffer WASticker
     */
    build = async () => {
        const data = await this._parse();
        const mime = await this._getMimeType(data);
        const isWebP = mime.includes('webp');
        const isVideo = mime.startsWith('video');
        const media = isVideo
            ? await this.processAnimated(data)
            : isWebP
                ? data
                : this.crop === 'nobg'
                    ? await this.processNoBG(data)
                    : Object.keys(cropType).includes(this.crop)
                        ? await this.cropImage(data)
                        : await this.processImage(data);
        const result = await this.addMetadata(media);
        return result;
    };

    /**
     * Get Baileys-MD message object format
     * @returns {Promise<{ sticker: Buffer }>}
     * @example
     * const media = new Sticker(buffer, { packname: 'mg.bot pack', author: '@gimenz.id', packId: '', categories: 'love' })
     * await client.sendMessage(from, await data.toMessage(), { quoted: m })
     */
    toMessage = async () => ({ sticker: await this.build() });

    /**
     *
     * @typedef {Object} RawMetadata
     * @property {Array<string>} emoji WASticker Emoji Categories
     * @property {string} sticker-pack-id WASticker Pack ID
     * @property {string} sticker-pack-name WASticker Pack Name
     * @property {string} sticker-pack-publisher WASticker Pack Author
     */

    /**
     * Extracts metadata from a WebP image.
     * @param {Buffer} input - The image buffer to extract metadata from
     * @returns {Promise<RawMetadata>}
     */
    static async extract(input) {
        const img = new Image();
        await img.load(input);
        const exif = img.exif?.toString('utf-8') ?? '{}';
        return JSON.parse(exif.substring(exif.indexOf('{'), exif.lastIndexOf('}') + 1) ?? '{}');
    }

    /**
     * Convert webp File to Buffer
     * @param {Buffer} buffer
     * @param {string} fileType
     * @returns
     */
    static async toVideo(buffer, fileType = 'webp') {
        const savePath = `${__dirname}/temp/sticker_${randomBytes(3).toString('hex')}.${fileType}`;
        fs.writeFileSync(savePath, buffer);
        const res = await EzGif.WebP2mp4(savePath);
        if (isUrl(res)) fs.unlinkSync(savePath);
        return res;
    }
}

module.exports = {
    Sticker,
    cropStyle,
};
