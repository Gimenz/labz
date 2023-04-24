/* eslint-disable no-unused-expressions */
/* eslint-disable no-return-await */
/* eslint-disable no-dupe-else-if */
/* eslint-disable no-multi-assign */
/* eslint-disable no-param-reassign */
global.fs = require('fs');
global.util = require('util');
const fileType = require('file-type');

const { default: PhoneNumber } = require('awesome-phonenumber');
const {
    proto,
    downloadContentFromMessage,
    generateWAMessageFromContent,
    WAProto,
    toBuffer,
    getContentType,
    generateForwardMessageContent,
    getDevice,
    generateThumbnail,
    prepareWAMessageMedia,
    areJidsSameUser,
    jidNormalizedUser,
    getBinaryNodeMessages,
    WAMetric,
    WAFlag,
    isJidGroup,
    isJidBroadcast,
    extractMessageContent,
} = require('../../Baileys');
const { getBuffer } = require('../utils');
const { download } = require('./function');

const config = fs.readFileSync('./src/config.json');

/**
 *
 * @param {proto.IMessage} message
 * @returns
 */
const downloadMediaMessage = async (message, filename, attachExtension = true) => {
    m = message.quoted !== null ? message : message.msg;
    const mediaType = {
        imageMessage: 'image',
        videoMessage: 'video',
        stickerMessage: 'sticker',
        documentMessage: 'document',
        audioMessage: 'audio',
    };

    const stream = await downloadContentFromMessage(m, mediaType[message.mtype]);
    const buffer = await toBuffer(stream);
    if (filename) {
        const extension = await fileType.fromBuffer(buffer);
        const trueFileName = attachExtension ? (`${filename}.${extension.ext}`) : filename;
        await fs.writeFileSync(trueFileName, buffer);
        return trueFileName;
    }
    return buffer;
};

/**
 *
 * @param {string} jid
 * @param {proto.WebMessageInfo} copy
 * @param {string} text
 * @param {string} sender
 * @param {*} options
 * @returns
 */
function cMod(jid, copy, text = '', sender = client.user.id, options = {}) {
    // let copy = message.toJSON()
    let mtype = getContentType(copy.message);
    const isEphemeral = mtype === 'ephemeralMessage';
    if (isEphemeral) {
        mtype = Object.keys(copy.message.ephemeralMessage.message)[0];
    }
    const msg = isEphemeral ? copy.message.ephemeralMessage.message : copy.message;
    const content = msg[mtype];
    if (typeof content === 'string') msg[mtype] = text || content;
    else if (text || content.caption) content.caption = text || content.caption;
    else if (content.text) content.text = text || content.text;
    if (typeof content !== 'string') {
        msg[mtype] = {
            ...content,
            ...options,
        };
    }
    if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant;
    else if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant;
    if (copy.key.remoteJid.includes('@s.whatsapp.net')) sender = sender || copy.key.remoteJid;
    else if (copy.key.remoteJid.includes('@broadcast')) sender = sender || copy.key.remoteJid;
    copy.key.remoteJid = jid;
    copy.key.fromMe = areJidsSameUser(sender, client.user.id);
    if (options.mentions) {
        copy.message[mtype].contextInfo.mentionedJid = options.mentions;
    }

    return proto.WebMessageInfo.fromObject(copy);
}

/**
 *
 * @param {string} jid
 * @param {proto.WebMessageInfo} message
 * @param {boolean} forceForward
 * @param {any} options
 * @returns
 */
async function copyNForward(jid, message, forceForward = false, options = {}) {
    let vtype;
    if (options.readViewOnce && message.message.viewOnceMessageV2?.message) {
        vtype = Object.keys(message.message.viewOnceMessageV2.message)[0];
        delete message.message.viewOnceMessageV2.message[vtype].viewOnce;
        message.message = proto.Message.fromObject(
            JSON.parse(JSON.stringify(message.message.viewOnceMessageV2.message)),
        );
        // console.log(message.message);
        // message.message[vtype].contextInfo = message.message?.viewOnceMessage?.contextInfo
    }

    const content = generateForwardMessageContent(message, forceForward);
    const ctype = getContentType(content);
    const context = {};
    // if (mtype != "conversation") context = message.message[mtype].contextInfo
    content[ctype].contextInfo = {
        ...context,
        ...content[ctype].contextInfo,
    };
    const waMessage = generateWAMessageFromContent(jid, content, options ? {
        ...content[ctype],
        ...options,
        ...(options.contextInfo ? {
            contextInfo: {
                ...content[ctype].contextInfo,
                mentionedJid: options.mentions ? options.mentions : [],
                ...options.contextInfo,
            },
        } : {}),
    } : {});
    await client.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
    return waMessage;
}

async function sendFile(jid, path, quoted, options = {}) {
    const mimetype = 'audio/mp4';// getDevice(quoted.id) == 'ios' ? 'audio/mpeg' : 'audio/mp4'
    const opt = { fileName: options.fileName || '', ...options };
    if (options.audio) opt.audio = Buffer.isBuffer(path) ? { buffer: path, mimetype } : { url: path, mimetype };
    if (options.document) opt.document = Buffer.isBuffer(path) ? { buffer: path, mimetype: options.mimetype } : { url: path, mimetype: options.mimetype };
    if (options.image) opt.image = Buffer.isBuffer(path) ? { buffer: path, mimetype: options.mimetype } : { url: path, mimetype: options.mimetype };
    await client.sendMessage(jid, opt, { quoted })
        .then(() => {
            try {
                if (options.unlink) {
                    console.log('unlink');
                    fs.unlinkSync(path);
                }
            } catch (error) {
                console.log(error);
            }
        });
}

/**
 * send group invitation via message
 * @param {string} jid gorupJid
 * @param {string} participant this message sent to?
 * @param {string} inviteCode group invite code
 * @param {Number} inviteExpiration invite expiration
 * @param {string} groupName group name
 * @param {string} jpegThumbnail file path or url
 * @param {string} caption message caption
 * @param {any} options message options
 */
async function sendGroupV4Invite(jid, participant, inviteCode, inviteExpiration, groupName, jpegThumbnail, caption = 'Invitation to join my WhatsApp group', options = {}) {
    const msg = WAProto.Message.fromObject({
        groupInviteMessage: WAProto.Message.GroupInviteMessage.fromObject({
            inviteCode,
            inviteExpiration: inviteExpiration ? parseInt(inviteExpiration, 10) : +new Date(new Date() + (3 * 86400000)),
            groupJid: jid,
            groupName: groupName || (await client.groupMetadata(jid)).subject,
            jpegThumbnail: jpegThumbnail ? (await getBuffer(jpegThumbnail)).buffer : '',
            caption,
        }),
    });
    const m = generateWAMessageFromContent(participant, msg, options);
    await client.relayMessage(participant, m.message, { messageId: m.key.id });
}

/**
 * send ListMessage with custom array
 * @param {string} jid this message send to?
 * @param {Object} button { buttonText, description, title }
 * @param {Array|Object} rows list of edited rows
 * @param {Object} quoted quoted m
 * @param {Object} options
 * @returns
 */
async function sendListM(jid, button, rows, quoted, options = {}) {
    if (config.composing) {
        await client.sendPresenceUpdate('composing', jid);
    }
    const listM = {
        buttonText: button.buttonText,
        text: button.description,
        // listType: 1,
        sections: [
            {
                title: button.title,
                rows: [...rows],
            },
        ],
        ...options,
    };

    return await client.sendMessage(jid, listM, { quoted });
    // let messageList = WAProto.Message.fromObject({
    //     listMessage: WAProto.Message.ListMessage.fromObject({
    //         buttonText: button.buttonText,
    //         description: button.description,
    //         listType: 1,
    //         sections: [
    //             {
    //                 title: button.title,
    //                 rows: [...rows]
    //             }
    //         ],
    //         ...options
    //     })
    // })
    // let waMessageList = generateWAMessageFromContent(jid, messageList, { quoted, userJid: jid, contextInfo: { ...options } })
    // return await client.relayMessage(jid, waMessageList.message, { messageId: waMessageList.key.id })
}

async function sendContact(jid, numbers, name, quoted, men) {
    const number = numbers.replace(/[^0-9]/g, '');
    const vcard = 'BEGIN:VCARD\n'
        + 'VERSION:3.0\n'
        + `FN:${name}\n`
        + 'ORG:;\n'
        + `TEL;type=CELL;type=VOICE;waid=${number}:+${number}\n`
        + 'END:VCARD';
    return client.sendMessage(jid, { contacts: { displayName: name, contacts: [{ vcard }] }, mentions: men || [] }, { quoted });
}

/** get your contacts stories
 *  did not work yet
*/
const getStories = async () => {
    const { content } = await client.query({
        json: {
            tag: 'query',
            attrs: {
                epoch: '0',
                type: 'status',
            },
        },
        binaryTag: [WAMetric.queryStatus, WAFlag.ignore],
        expect200: true,
        requiresPhoneConnection: true,
    });
    if (Array.isArray(content)) {
        return content.map((data) => getBinaryNodeMessages(data));
    }
    return [];
};

/** Get your contacts */
exports.getContacts = async () => {
    const json = {
        tag: 'query',
        attrs: {
            epoch: client.currentEpoch().toString(),
            type: 'contacts',
        },
    };
    const response = await client.query({
        json, binaryTag: [WAMetric.queryContact, WAFlag.ignore], expect200: true, requiresPhoneConnection: true,
    }); // this has to be an encrypted query
    const contacts = response.content.map(({ attrs }) => ({
        id: jidNormalizedUser(attrs.jid),
        name: attrs.name,
        notify: attrs.notify,
        verifiedName: attrs.verify === '2' ? attrs.vname : undefined,
    }));
    return contacts;
};

// eslint-disable-next-line no-unused-vars
const getName = (jid, withoutContact = true) => {
    const v = contacts[jid];
    return (withoutContact ? '' : v.name) || v.vname || v.notify || PhoneNumber(`+${jidDecode(jid).user}`).getNumber('international');
};

/**
 * Send files from url with automatic file type specifier
 * @param {string} jid this message sent to?
 * @param {string} url url which contains media
 * @param {string} caption media message with caption, default is blank
 * @param {string} quoted the message you want to quote
 * @param {string} mentionedJid mentionedJid
 * @param {string} extension custom file extensions
 * @param {any} options
 */
async function sendFileFromUrl(jid, url, caption, quoted, mentionedJid, extension, options = {}, axiosOptions = {}) {
    let unlink;
    try {
        await client.presenceSubscribe(jid);
        if (config.composing) {
            await client.sendPresenceUpdate('composing', jid);
        }
        const { filepath, mimetype } = await download(url, extension, axiosOptions);
        unlink = filepath;
        mentionedJid = mentionedJid ? parseMention(mentionedJid) : [];
        const mime = mimetype.split('/')[0];
        const thumb = await generateThumbnail(filepath, mime);
        if (mimetype == 'image/gif' || options.gif) {
            const message = await prepareWAMessageMedia({
                video: { url: filepath }, caption, gifPlayback: true, gifAttribution: 1, mentions: mentionedJid, jpegThumbnail: thumb.thumbnail, ...options,
            }, { upload: client.waUploadToServer });
            const media = generateWAMessageFromContent(jid, { videoMessage: message.videoMessage }, { quoted, mediaUploadTimeoutMs: 600000 });
            fs.unlinkSync(filepath);
            return await client.relayMessage(jid, media.message, { messageId: media.key.id });
        } if (mime == 'video') {
            const message = await prepareWAMessageMedia({
                video: { url: filepath }, caption, mentions: mentionedJid, jpegThumbnail: thumb.thumbnail, ...options,
            }, { upload: client.waUploadToServer });
            const media = generateWAMessageFromContent(jid, { videoMessage: message.videoMessage }, { quoted, mediaUploadTimeoutMs: 600000 });
            fs.unlinkSync(filepath);
            return await client.relayMessage(jid, media.message, { messageId: media.key.id });
        } if (mime == 'image') {
            const message = await prepareWAMessageMedia({
                image: { url: filepath }, caption, mentions: mentionedJid, jpegThumbnail: thumb.thumbnail, ...options,
            }, { upload: client.waUploadToServer });
            const media = generateWAMessageFromContent(jid, { imageMessage: message.imageMessage }, { quoted, mediaUploadTimeoutMs: 600000 });
            fs.unlinkSync(filepath);
            return await client.relayMessage(jid, media.message, { messageId: media.key.id });
        } if (mime == 'audio') {
            await client.sendPresenceUpdate('recording', jid);
            const message = await prepareWAMessageMedia({ document: { url: filepath }, mimetype, fileName: options.fileName }, { upload: client.waUploadToServer });
            const media = generateWAMessageFromContent(jid, { documentMessage: message.documentMessage }, { quoted, mediaUploadTimeoutMs: 600000 });
            fs.unlinkSync(filepath);
            return await client.relayMessage(jid, media.message, { messageId: media.key.id });
        }
        const message = await prepareWAMessageMedia({ document: { url: filepath }, mimetype, fileName: options.fileName }, { upload: client.waUploadToServer });
        const media = generateWAMessageFromContent(jid, { documentMessage: message.documentMessage }, { quoted, mediaUploadTimeoutMs: 600000 });
        fs.unlinkSync(filepath);
        return await client.relayMessage(jid, media.message, { messageId: media.key.id });
    } catch (error) {
        unlink ? fs.unlinkSync(unlink) : '';
        client.sendMessage(jid, { text: `error nganu => ${util.format(error)} ` }, { quoted });
    }
}

/**
 *
 * @param {AnyWASocket} sock
 * @param {proto.IWebMessageInfo} m
 * @returns
 */
exports.Serialize = (sock, m) => {
    sock.downloadMediaMessage = downloadMediaMessage;
    sock.cMod = cMod;
    sock.copyNForward = copyNForward;
    sock.sendFile = sendFile;
    sock.sendGroupV4Invite = sendGroupV4Invite;
    sock.sendListM = sendListM;
    sock.sendContact = sendContact;
    sock.sendFileFromUrl = sendFileFromUrl;
    sock.getStories = getStories;
    client.getContacts = this.getContacts;
    if (!m) return m;
    const M = proto.WebMessageInfo;
    if (m.key) {
        m.id = m.key.id;
        m.isBot = (m.id.startsWith('BAE5') && m.id.length === 16);
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = m.fromMe
            ? jidNormalizedUser(sock.user.id) || ''
            : (
                isJidGroup(m.key.remoteJid)
                    ? jidNormalizedUser(m.key.participant)
                    : isJidBroadcast(m.key.remoteJid)
                        ? jidNormalizedUser(m.key.participant)
                        : jidNormalizedUser(m.key.remoteJid)
            );
        m.device = getDevice(m.id);
        m.key = {
            remoteJid: m.chat,
            fromMe: m.fromMe,
            id: m.id,
            participant: m.sender,
        };
    }
    if (m.message) {
        m.mtype = getContentType(m.message);
        // m.body = m.message.conversation || m.message[m.mtype].caption || m.message[m.mtype].text || (m.mtype == 'listResponseMessage') && m.message[m.mtype].singleSelectReply.selectedRowId || (m.mtype == 'buttonsResponseMessage') && m.message[m.mtype].selectedButtonId || m.mtype
        m.msg = (m.mtype == 'viewOnceMessageV2' ? m.message?.viewOnceMessageV2.message[getContentType(m.message.viewOnceMessageV2.message)] : m.message[m.mtype]);
        // m.msg = m.message[m.type]
        m.message = extractMessageContent(m.message);
        if (m.mtype === 'ephemeralMessage') {
            this.Serialize(sock, m.msg);
            m.mtype = m.msg.mtype;
            m.msg = m.msg.msg;
        }
        const quoted = m.quoted = m.msg?.contextInfo ? m.msg?.contextInfo.quotedMessage : null;
        m.mentionedJid = m.msg?.contextInfo ? m.msg?.contextInfo.mentionedJid : [];
        if (m.quoted) {
            let type = Object.keys(m.quoted)[0] == 'viewOnceMessageV2' ? 'viewOnceMessageV2' : getContentType(m.quoted);
            m.quoted = m.quoted[type];
            if (['productMessage'].includes(type)) {
                type = Object.keys(m.quoted)[0];
                m.quoted = m.quoted[type];
            }
            if (typeof m.quoted === 'string') {
                m.quoted = {
                    text: m.quoted,
                };
            }
            m.quoted.mtype = type;
            m.quoted.id = m.msg.contextInfo.stanzaId;
            m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat;
            m.quoted.isBot = m.quoted.id
                ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false;
            m.quoted.sender = m.msg.contextInfo.participant.split(':')[0]
                || m.msg.contextInfo.participant;
            m.quoted.fromMe = areJidsSameUser(m.quoted.sender, (sock.user && sock.user.id));
            m.quoted.text = m.quoted.text || m.quoted.caption || '';
            m.quoted.device = getDevice(m.quoted.id);
            m.quoted.key = {
                remoteJid: m.quoted.chat,
                fromMe: m.quoted.fromMe,
                id: m.quoted.id,
                participant: m.quoted.sender,
            };
            m.quoted.mentionedJid = m.msg.contextInfo
                ? m.msg.contextInfo.mentionedJid
                : [];
            const vM = m.quoted.fakeObj = M.fromObject({
                key: {
                    remoteJid: m.quoted.chat,
                    fromMe: m.quoted.fromMe,
                    id: m.quoted.id,
                    participant: m.quoted.sender,
                },
                message: quoted,
                ...(m.isGroup ? { participant: m.quoted.sender } : {}),
            });
            m.quotedMsg = m.getQuotedObj = () => vM;

            /**
             *
             * @returns
             */
            m.quoted.delete = () => sock.sendMessage(m.quoted.chat, { delete: vM.key });

            /**
             *
             * @param {*} jid
             * @param {*} forceForward
             * @param {*} options
             * @returns
            */
            m.quoted.copyNForward = (jid, forceForward = false, options = {}) => sock.copyNForward(jid, vM, forceForward, options);

            /**
              *
              * @returns
            */
            m.quoted.download = () => sock.downloadMediaMessage(m.quoted);
            /**
             * Modify quoted Message
             * @param {String} jid
             * @param {String} text
             * @param {String} sender
             * @param {Object} options
             */
            m.quoted.cMod = (jid, text = '', sender = m.quoted.sender, options = {}) => sock.cMod(jid, vM, text, sender, options);

            /**
             *
             * @param {string} reaction emoji
             * @returns
             */
            m.quoted.react = (reaction) => sock.sendMessage(m.chat, {
                react: {
                    text: reaction,
                    key: m.quoted.key,
                },
            });
        }
    }
    m.download = () => sock.downloadMediaMessage(m.msg);
    m.text = (m.mtype == 'listResponseMessage' ? m.msg.singleSelectReply.selectedRowId : '') || m.mtype == 'viewOnceMessageV2' ? m.msg.caption : '' || m.msg.caption || m.msg.text || m.msg || '';
    // m.text = m.msg.text || m.msg.caption || m.message.conversation || m.msg.contentText || m.msg.selectedDisplayText || m.msg.title || '';
    // m.text = m.message?.conversation || m.message?.[m.type]?.text || m.message?.[m.type]?.caption || m.message?.[m.type]?.contentText || m.message?.[m.type]?.selectedDisplayText || m.message?.[m.type]?.title || ""
    /**
    * Reply to this message
    * @param {String|Object} text
    * @param {String|false} chatId
    * @param {Object} options
    */
    m.reply = async (text, options, jid = m.chat) => {
        if (config.composing) {
            await sock.presenceSubscribe(jid);
            await sock.sendPresenceUpdate('composing', jid);
        }
        return await sock.sendMessage(jid, { text, ...options }, { quoted: m, ...options });
    };
    m.replyTextButton = async (text, templateButtons, footer = global.footer, options = {}, jid = m.chat) => await sock.sendMessage(jid, {
        footer, text, templateButtons, headerType: 2, ...options,
    }, { quoted: m, ...options });
    /**
    * Copy this message
    */
    m.copy = () => exports.Serialize(sock, M.fromObject(M.toObject(m)));

    /**
     *
     * @param {*} jid
     * @param {*} forceForward
     * @param {*} options
     * @returns
     */
    m.copyNForward = (jid = m.chat, forceForward = false, options = {}) => sock.copyNForward(jid, m.copy(), forceForward, options);
    /**
     * Modify this Message
     * @param {String} jid
     * @param {String} text
     * @param {String} sender
     * @param {Object} options
     */
    m.cMod = (jid, text = '', sender = m.sender, options = {}) => sock.cMod(jid, m, text, sender, options);
    return m;
};

exports.parseMention = (text) => [...text.matchAll(/@?([0-9]{5,16}|0)/g)].map((v) => v[1] + S_WHATSAPP_NET);

global.getContacts = this.getContacts;
