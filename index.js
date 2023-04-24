const { Boom } = require('@hapi/boom');
const P = require('pino');
const {
    default: makeWASocket,
    makeInMemoryStore,
    DisconnectReason,
    delay,
    isJidGroup,
    getContentType,
    isJidBroadcast,
    Browsers,
    useMultiFileAuthState,
    isJidStatusBroadcast,
    jidDecode,
} = require('@adiwajshing/baileys');
const moment = require('moment-timezone');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./src/config.json', 'utf-8'));
const { exec } = require('child_process');
const { igApi, shortcodeFormatter, IGPostRegex } = require('insta-fetcher');
const {
    color, bgColor, msgs, humanFileSize,
} = require('./utils');
const pkg = require('./package.json');
const { Serialize, parseMention } = require('./lib/simple');
const storyHandler = require('./lib/storyHandler');
const drive = require('./lib/drive');
const { Sticker, cropStyle } = require('./utils/sticker');
const { Emoji } = require('./utils/exif');

// eslint-disable-next-line new-cap
const ig = new igApi(config.igCookie);
global.ig = ig;
const scraper = require('./lib/scrapers');

const store = makeInMemoryStore({ logger: P().child({ level: 'debug', stream: 'store' }) });
global.store = store;
store.readFromFile(config.store);
setInterval(() => {
    store.writeToFile(config.store);
}, 10_000);

global.contacts = [];
global.hapus = global.hapus ? global.hapus : [];

// start a connection
const start = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(config.session);

    const client = makeWASocket({
        logger: P({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
        browser: Browsers.macOS('Safari'),
        markOnlineOnConnect: false,
    });

    global.client = client;
    store.bind(client.ev);

    client.ev.on('contacts.set', (c) => {
        global.contacts = c.contacts.reduce((a, b) => {
            // eslint-disable-next-line no-param-reassign
            a[b.id] = b;
            return a;
        });
    });

    client.ev.on('messages.upsert', async (msg) => {
        try {
            console.log(msg);
            if (!msg.messages) return;
            const m = msg.messages[0];
            const from = m.key.remoteJid;
            // let type = client.msgType = Object.keys(m.message)[0];
            const type = getContentType(m.message);

            client.readMessages([m.key]);

            // if (m.message && m.message.protocolMessage) {
            //     if (m.key.remoteJid !== '6283180527218@s.whatsapp.net') return;
            //     console.log(m);
            //     const msg = await store.loadMessage(m.key.remoteJid, m.key.id, undefined);

            //     console.log(msg);
            //     client.relayMessage(m.key.remoteJid, msg.message, { messageId: msg.id });
            // }

            Serialize(client, m);
            const t = m.messageTimestamp;
            const body = (type === 'conversation') ? m.message.conversation : (type === 'imageMessage') ? m.message.imageMessage.caption : (type === 'videoMessage') ? m.message.videoMessage.caption : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type === 'buttonsResponseMessage') ? m.message.buttonsResponseMessage.selectedButtonId : (type === 'listResponseMessage') ? m.message.listResponseMessage.singleSelectReply.selectedRowId : (type === 'templateButtonReplyMessage') ? m.message.templateButtonReplyMessage.selectedId : (type === 'messageContextInfo') ? (m.message.listResponseMessage.singleSelectReply.selectedRowId || m.message.buttonsResponseMessage.selectedButtonId || m.text) : '';

            const { sender } = m;
            const { user } = client;
            const pushname = m.key.fromMe
                ? user?.name || user?.verifiedName || user?.notify
                : m.pushName || global.contacts[sender].verifiedName
                || global.contacts[sender].notify || global.contacts[sender].name;
            const isGroupMsg = isJidGroup(from);
            const groupMetadata = isGroupMsg ? await client.groupMetadata(m.chat) : {};
            const formattedTitle = isGroupMsg ? groupMetadata.subject : '';
            global.prefix = '.';
            global.storyJid = m.chat;

            if (isJidStatusBroadcast(m.chat) && type !== 'protocolMessage' && config.downloadStory) {
                // console.log(m);
                const storySend = '120363026178080336@g.us'; // -> i send to group only myself where in its group
                // eslint-disable-next-line no-undef
                const ts = moment(t * 1000).format('DD/MM/YY HH:mm:ss');
                const caption = `*Story Stealer :*\n• Name : ${pushname}\n• From : wa.me/${sender.split('@')[0]}\n• Time : ${ts}\n• Caption : ${m.text}`;
                client.copyNForward(
                    storySend,
                    // eslint-disable-next-line max-len
                    client.cMod(storySend, m, caption, client.user.id, { contextInfo: m.contextInfo }),
                );
                await storyHandler.driveUpload(m);
            }

            if (type === 'viewOnceMessageV2') {
                // const storySend = '120363026178080336@g.us'; // -> i send to group only myself where in its group
                const storySend = config.owner; // -> i send to group only myself where in its group
                if (m.chat === '6285236189413-1601885520@g.us' || m.chat === '120363046074771147@g.us'); {
                    const ts = moment(m.messageTimestamp * 1000).format('DD/MM/YY HH:mm:ss');
                    client.copyNForward(storySend, m, true, { readViewOnce: true })
                        .then(async (f) => {
                            client.sendMessage(f.key.remoteJid, { text: `viewOnce message from:\ngroup : ${formattedTitle}\nname :${m.pushName}\njid : ${jidDecode(m.sender).user}\ntime : ${ts}` }, { quoted: f });
                        });
                }
            }

            const arg = body.substring(body.indexOf(' ') + 1);
            const args = body.trim().split(/ +/).slice(1);
            const flags = [];
            const isCmd = body.startsWith(global.prefix);
            const cmd = isCmd ? body.slice(1).trim().split(/ +/).shift()
                .toLowerCase() : null;
            const url = args.length !== 0 ? args[0] : '';

            // eslint-disable-next-line no-restricted-syntax
            for (const o of args) {
                if (o.startsWith('--')) flags.push(o.slice(2).toLowerCase());
            }

            const tipe = bgColor(color(type, 'black') + (isJidBroadcast(from) ? color(' Status', 'yellow') : ''), '#6dd5ed');

            // if (type == 'protocolMessage') {
            //     const msg = await store.loadMessage(m.key.remoteJid, m.key.id, undefined)
            //     console.log(msg);
            // }

            if (!isCmd && !isGroupMsg && !m.key.fromMe) {
                console.log('[MSG]', color(moment(t * 1000).format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), msgs(m.text), `~> ${(tipe)} from`, color(pushname, '#38ef7d'));
            }
            if (!isCmd && isGroupMsg && !m.key.fromMe) {
                console.log('[MSG]', color(moment(t * 1000).format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), msgs(m.text), `~> ${tipe} from`, color(pushname, '#38ef7d'), 'in', color(formattedTitle, '#C6FFDD'));
            }
            if (isCmd && !isGroupMsg && m.key.fromMe) {
                console.log(color('[CMD]'), color(moment(t * 1000).format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), color(`${cmd} [${args.length}]`), color(`${msgs(body)}`, 'cyan'), '~> from', color(pushname, '#38ef7d'));
            }
            if (isCmd && isGroupMsg && m.key.fromMe) {
                console.log(color('[CMD]'), color(moment(t * 1000).format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), color(`${cmd} [${args.length}]`), color(`${msgs(body)}`, 'cyan'), '~> from', color(pushname, '#38ef7d'), 'in', color(formattedTitle, '#C6FFDD'));
            }

            if (!m.key.fromMe) return;

            if ((m.quoted) && (/^pesan yang di hapus/i.test(m.quoted.text))) {
                if (!m.quoted) return;
                if (!/^pesan yang di hapus/i.test(m.quoted.text)) return;

                const terhapus = store.messages[m.chat];
                const filtered = [];
                terhapus.array.filter((x) => x.hasOwnProperty('message')).filter((x) => x.message.protocolMessage).map((x) => filtered.push(terhapus.get(x.message.protocolMessage.key.id)));

                if (m.text - 1 > filtered.length - 1) return;
                const result = filtered[m.text - 1];

                client.copyNForward(m.chat, result, true);
            }

            if (cmd === 'deleted') {
                if (isGroupMsg) return m.reply('private chat only');
                const terhapus = store.messages[m.chat];
                const filtered = [];
                terhapus.array.filter((x) => x.hasOwnProperty('message')).filter((x) => x.message.protocolMessage).map((x) => filtered.push(terhapus.get(x.message.protocolMessage.key.id)));

                if (filtered.length === 0) return m.reply('tidak ada history di database');
                let temp = `pesan yang di hapus: *${filtered.slice(-1)[0].hasOwnProperty('pushName') ? filtered.slice(-1)[0].pushName : m.chat}* | ${filtered.length} pesan\n\n`;
                let index = 1;

                // eslint-disable-next-line no-plusplus
                filtered.map(({ message, messageTimestamp }) => temp += `*${index++}*. ${moment(messageTimestamp * 1000).format('DD-MM-YYYY HH:mm:ss')} | ${getContentType(message)}\n`);

                m.reply(temp);
            }

            // if (cmd === 'viewmsg') {
            //     const [chatId, user] = arg.split('|');
            //     const terhapus = store.messages[chatId].filter((x) => x.key.id == user);

            //     console.log(terhapus);
            //     client.copyNForward(m.chat, terhapus.message, true);
            // }

            if (cmd === '>') {
                const syntaxerror = require('syntax-error');
                let _return;
                let _syntax = '';
                const _text = body.slice(2);
                try {
                    let i = 15;
                    const execCode = new (async () => { }).constructor('print', 'msg', 'require', 'client', 'm', 'axios', 'fs', 'exec', _text);
                    _return = await execCode.call(client, (...args) => {
                        if (--i < 1) return;
                        console.log(...args);
                        return m.reply(util.format(...args));
                    }, msg, require, client, m, axios, fs, execCode);
                } catch (e) {
                    const err = syntaxerror(_text, 'Execution Function', {
                        allowReturnOutsideFunction: true,
                        allowAwaitOutsideFunction: true,
                    });
                    if (err) _syntax = `\`\`\`${err}\`\`\`\n\n`;
                    _return = e;
                } finally {
                    m.reply(_syntax + util.format(_return));
                }
            }
            if (cmd === '$') {
                exec(body.slice(2), (err, stdout) => {
                    console.log(err, stdout);
                    if (err) return m.reply(`${err}`);
                    if (stdout) m.reply(`${stdout}`);
                });
            }

            // did not work anymore, unless WA updated the features to interact with Stories
            if (cmd === 'getstory') {
                if (!m.key.fromMe) return;
                if (m.quoted) { // -> reply story to get their media
                    m.quoted.copyNForward(global.storyJid);
                } else if (arg.match(/@?([0-9]{5,16}|0)/g)) {
                    const stories = await client.getStories();
                    if (stories.length === 0) return m.reply('tidak ada story dari kontak anda');
                    const user = m.mentionedJid.length ? m.mentionedJid[0] : parseMention(args.join(' '))[0];
                    const res = stories.map(((x) => x.filter((v) => v.key.participant.match(user)))).find((c) => c.length);
                    if (res === undefined || res.length < 1) return m.reply(`tidak ada story dari user ${user}`);
                    if (args.includes('|')) {
                        const index = arg.split('|')[1].trim();
                        if (parseInt(index, 10) > res.length) return m.reply(`story dari ${user} hanya ada ${res.length}`);
                        await client.copyNForward(global.storyJid, res[index - 1]);
                    } else {
                        res.map(async (v) => client.copyNForward(global.storyJid, v));
                    }
                } else if (args.length >= 2) {
                    const stories = await client.getStories();
                    if (stories.length === 0) return m.reply('tidak ada story dari kontak anda');
                    const parsed = stories.sort((a, b) => new Date(b.slice(-1).messageTimestamp * 1000) - new Date(a.slice(-1).messageTimestamp * 1000));
                    if (args.length === 2) {
                        const indexStory = args[0];
                        const indexMedia = args[1];
                        if ((indexStory - 1) > parsed.length) return m.reply('tidak ada story');
                        if ((indexMedia - 1) > parsed[indexStory - 1].length) return m.reply(`story no *${indexStory - 1}* hanya ada *${parsed[indexStory - 1].length}* media`);
                        await m.reply(`downloading stories No. *${indexMedia}* from *${client.getName(parsed[indexStory - 1][indexMedia - 1].key.participant, false)}*`);
                        await client.copyNForward(global.storyJid, parsed[indexStory - 1][indexMedia - 1]);
                    } else if (args.length === 1) {
                        const indexStory = args[0] - 1;
                        const allMedia = parsed[indexStory];
                        await m.reply(`downloading all stories from *${client.getName(parsed[indexStory + 1][0].key.participant, false)}*`);
                        allMedia.map(async (x) => client.copyNForward(global.storyJid, x));
                    }
                } else {
                    m.reply('Mendownload story WA dari kontak\n\nContoh :\n\n'
                        + `*- by no WA*\n${prefix + cmd} 628xxx - *(mendownload semua story dari kontak 628xxx)*\n${prefix + cmd} 628xxx | 1 - *(mendownload story ke 1 dari kontak 628xxx)*\n\n`
                        + `*- by index* _(no urut story)_\n${prefix + cmd} 1 - *(mendownload semua story dari index 1)*\n${prefix + cmd} 1 3 *(mendownload story ke 3 n)*`);
                }
            }

            switch (cmd) {
            case 'tik': case 't': case 'tiktok':
                if (args.length === 0) return m.reply('linknya mana?');
                try {
                    m.reply('proses');
                    const data = await scraper.tiktokDL(args.join(' '));
                    const author = `Post from @${data.author.unique_id}` || '';
                    const caption = `*Success* - ${author} [${data.desc}]`;
                    if (data.hasOwnProperty('image_post_info')) {
                        const images = data.image_post_info.images.map((x) => x.display_image.url_list[1]);
                        m.reply(`${caption}\n\n${images.length} medias`);
                        for (let i = 0; i < images.length; i++) {
                            await delay(2000);
                            await client.sendFileFromUrl(from, images[i], '', m);
                        }
                    } else {
                        await client.sendFileFromUrl(from, data.video.play_addr.url_list[0], caption, m, '', 'mp4');
                    }
                } catch (error) {
                    console.log(error);
                    await m.reply(util.format(error));
                }
                break;
            case 'ig':
                if (/https:\/\/(www\.)?instagram\.com\/stories\/.+/g.test(body)) {
                    try {
                        m.reply('proses');
                        const u = body.match(/https:\/\/(www\.)?instagram\.com\/stories\/.+/g)[0];
                        const s = u.indexOf('?') >= 0 ? u.split('?')[0] : (u.split('').pop() === '/' !== true ? `${u}` : u);
                        const [username, storyId] = s.split('/stories/')[1].split('/');
                        const data = await ig.fetchStories(username);
                        const media = data.stories.filter((x) => x.id.match(storyId));
                        if (media[0].type === 'image') {
                            await client.sendFileFromUrl(
                                m.chat,
                                media[0].url,
                                `_Stories from @${username}_\nTaken at : ${moment(media[0].taken_at * 1000).format('DD/MM/YY HH:mm:ss')}`,
                                m,
                                '',
                                'jpeg',
                                { height: media[0].original_height, width: media[0].original_width },
                            );
                        } else {
                            await client.sendFileFromUrl(
                                m.chat,
                                media[0].url,
                                `_Stories from @${username}_\nTaken at : ${moment(media[0].taken_at * 1000).format('DD/MM/YY HH:mm:ss')}`,
                                m,
                                '',
                                'mp4',
                                { height: media[0].original_height, width: media[0].original_width },
                            );
                        }
                    } catch (error) {
                        console.log(error);
                        await m.reply(util.format(error));
                    }
                } else if (IGPostRegex.test(body)) {
                    try {
                        m.reply('proses');
                        const { url } = shortcodeFormatter(body);
                        const result = await ig.fetchPost(url);
                        const arr = result.links;
                        let capt = '✅ *Sukses Download Post Instagram*\n';
                        capt += `• Name : ${result.name}\n`;
                        capt += `• Username : ${result.username}\n`;
                        capt += `• Likes : ${result.likes}\n`;
                        capt += `• Post Type : ${result.postType}\n`;
                        capt += `• Media Count : ${result.media_count}`;
                        m.reply(capt);
                        for (let i = 0; i < arr.length; i++) {
                            await client.sendFileFromUrl(m.chat, arr[i].url, '', m, '', arr[i].type === 'image' ? 'jpeg' : 'mp4', { height: arr[i].dimensions.height, width: arr[i].dimensions.width });
                        }
                    } catch (error) {
                        console.log(error);
                        await m.reply(util.format(error));
                    }
                }
                break;
            case 'igs':
                if (/https:\/\/(www\.)?instagram\.com\/stories\/.+/g.test(body)) {
                    try {
                        m.reply('proses');
                        const u = body.match(/https:\/\/(www\.)?instagram\.com\/stories\/.+/g)[0];
                        const s = u.indexOf('?') >= 0 ? u.split('?')[0] : (u.split('').pop() === '/' !== true ? `${u}` : u);
                        const [username, storyId] = s.split('/stories/')[1].split('/');
                        const data = await ig.fetchStories(username);
                        const media = data.stories.filter((x) => x.id.match(storyId));

                        const cap = `_Stories from @${username}_\nTaken at : ${moment(media[0].taken_at * 1000).format('DD/MM/YY HH:mm:ss')}`;
                        await client.sendFileFromUrl(m.chat, media[0].url, cap, m, '', media[0].type === 'image' ? 'jpeg' : 'mp4', { height: media[0].original_height, width: media[0].original_width });
                    } catch (error) {
                        console.log(error);
                        await m.reply(util.format(error));
                    }
                } else if (args.length > 1 && !isNaN(args[1])) {
                    try {
                        const username = args[0];
                        const nomer = args[1] - 1;
                        m.reply(`_Scraping ig stories no. ${nomer + 1} from @${username}_`);
                        await ig.fetchStories(username)
                            .then(async (data) => {
                                if (data.stories_count === 0) return m.reply(`tidak ada stori dari akun @${username}`);
                                if (nomer > data.stories_count) return m.reply(`story dari akun @${username} hanya ada ${data.stories_count}`);
                                const story = data.stories[nomer];
                                if (story.type === 'image') {
                                    await client.sendFileFromUrl(
                                        m.chat,
                                        story.url,
                                        `_Stories from @${username}_\nTaken at : ${moment(story.taken_at * 1000).format('DD/MM/YY HH:mm:ss')}`,
                                        m,
                                        '',
                                        'jpeg',
                                        { height: story.original_height, width: story.original_width },
                                    );
                                } else {
                                    await client.sendFileFromUrl(
                                        m.chat,
                                        story.url,
                                        `_Stories from @${username}_\nTaken at : ${moment(story.taken_at * 1000).format('DD/MM/YY HH:mm:ss')}`,
                                        m,
                                        '',
                                        'mp4',
                                        { height: story.original_height, width: story.original_width },
                                    );
                                }
                            });
                    } catch (error) {
                        m.reply(util.format(error));
                    }
                } else if (args.length > 1 && args[1].includes('-') && isNaN(args[1])) {
                    try {
                        const username = args[0];
                        const nomer = args[1];
                        const idxNUM = nomer.split('-');
                        const dari = idxNUM[0];
                        const ke = idxNUM[1];
                        const max = (ke - dari);
                        if (max > 10) return await m.reply('Terlalu banyak stories! max 10');
                        await m.reply(`_Scraping stories no ${idxNUM[0]}-${idxNUM[1]} from @${username}_`);
                        await ig.fetchStories(username)
                            .then(async (data) => {
                                const stories = data.stories.slice(idxNUM[0] - 1, idxNUM[1]);
                                if (dari > data.stories_count || ke > data.stories_count) return m.reply(`Stories dari akun @${data.username} cuma ada ${data.stories_count}!`);
                                for (const story of stories) {
                                    delay(1000);
                                    await client.sendFileFromUrl(
                                        m.chat,
                                        story.url,
                                        `_Stories from @${username}_\nTaken at : ${moment(story.taken_at * 1000).format('DD/MM/YY HH:mm:ss')}`,
                                        m,
                                        '',
                                        story.type === 'image' ? 'jpeg' : 'mp4',
                                        { height: story.original_height, width: story.original_width },
                                    );
                                }
                            });
                    } catch (error) {
                        m.reply(util.format(error));
                    }
                } else {
                    try {
                        const username = args[0];
                        await m.reply(`_Scraping All stories from @${username}_`);
                        await ig.fetchStories(username)
                            .then(async (data) => {
                                const stories = data.stories;
                                m.reply(`${data.stories_count} stories dari akun @${username}`);
                                for (const story of stories) {
                                    if (data.stories_count < 10) delay(1000);
                                    else delay(3000);
                                    await client.sendFileFromUrl(
                                        m.chat,
                                        story.url,
                                        `_Stories from @${username}_\nTaken at : ${moment(story.taken_at * 1000).format('DD/MM/YY HH:mm:ss')}`,
                                        m,
                                        '',
                                        story.type == 'image' ? 'jpeg' : 'mp4',
                                        { height: story.original_height, width: story.original_width },
                                    );
                                }
                            });
                    } catch (error) {
                        m.reply(util.format(error));
                    }
                }
                break;
            case 'help': case 'menu': case 'mnu':
                const help = fs.readFileSync('./src/menu.txt', 'utf-8');
                m.reply(help.replace(/prefix/g, `${prefix}`));
                break;
            case 'ava':
                try {
                    if (m.quoted) {
                        const c = store.contacts[m.quoted.sender] || 'unknown';
                        console.log(c);
                        const img = await client.profilePictureUrl(m.quoted.sender, 'image');
                        await client.sendMessage(m.chat, { image: { url: img }, caption: `${c}` });
                    } else if (m.mentionedJid.length) {
                        const img = await client.profilePictureUrl(m.mentionedJid[0], 'image');
                        await client.sendMessage(m.chat, { image: { url: img } });
                    } else if (arg.match(/([0-9]{5,16}|0)/g)) {
                        const img = await client.profilePictureUrl(parseMention(arg)[0], 'image');
                        await client.sendMessage(m.chat, { image: { url: img } });
                    } else {
                        m.reply(`reply message, @tag, user, or phone number, e.g : ${prefix + cmd} 62852366`);
                    }
                } catch (error) {
                    console.log(error);
                    m.reply('no picture');
                }
                break;
            case 'view':
                if (m.quoted) {
                    if (m.quoted.mtype !== 'viewOnceMessageV2') return m.reply('Bukan viewOnce msg!');
                    m.quoted.copyNForward(m.chat, true, { readViewOnce: true });
                } else {
                    m.reply('No Media!');
                }
                break;
            case 'downloadstory':
            case 'detectstory':
                if (args[0] === 'on') {
                    if (config.downloadStory === true) return reply('Already Activated!');
                    config.downloadStory = true;
                    downloadStory = true;
                    fs.writeFileSync('./src/config.json', JSON.stringify(config, null, 2));
                    await m.reply('✅ Detect story has been enabled!\nStatus : *ON*');
                } else if (args[0] === 'off') {
                    if (config.downloadStory === false) return reply('Already Deactivated!');
                    config.downloadStory = false;
                    downloadStory = false;
                    fs.writeFileSync('./src/config.json', JSON.stringify(config, null, 2));
                    await m.reply('❌ Detect story has been disabled!\nStatus : *OFF*');
                } else {
                    m.reply('Pilih on apa off');
                }
                break;
            case 'upload':
                try {
                    if (!m.quoted || m.quoted.mtype == 'conversation') return m.reply('reply media');
                    const folderName = 'WA_Media_Uploader';
                    const tmpPath = `./tmp/${m.quoted.sender.split('@')[0]}_${moment().format('DD.MM.YYYY')}`;
                    // create folder if not exists
                    const folder = await drive.checkFolderExists(folderName);
                    let folderId;
                    if (!folder.exists) {
                        const create = await drive.createFolder(folderName);
                        folderId = create.id;
                    } else {
                        folderId = folder.id;
                    }

                    const save = await client.downloadMediaMessage(m.quoted, tmpPath);
                    const response = await drive.uploadFile(save, folderId);
                    const driveStats = await drive.driveStats();
                    let txt = '💾 *Google Drive Stats*\n';
                    txt += `\n~> https://drive.google.com/file/d/${response.data.id}\n`;
                    txt += `\n*${humanFileSize(driveStats.usage)}* of ${humanFileSize(driveStats.limit)}`;
                    txt += `\n*Free Space* : _${humanFileSize(driveStats.limit - driveStats.usage)}_`;
                    m.reply(txt);
                } catch (error) {
                    console.log(error);
                }
                break;
            default:
                break;
            }

            // cmd with regex
            switch (true) {
            case /^s(|ti(c|)ker)$/g.test(cmd):
                try {
                    const crop = flags.find((v) => cropStyle.map((x) => x == v.toLowerCase()));
                    const packname = /\|/i.test(body) ? arg.split('|')[0] : `${config.exif.packname}`;
                    const stickerAuthor = /\|/i.test(body) ? arg.split('|')[1] : `${config.exif.author}`;
                    const categories = Object.keys(Emoji).includes(arg.split('|')[2]) ? arg.split('|')[2] : 'love' || 'love';
                    if (m.mtype == 'imageMessage' || m.quoted && m.quoted.mtype == 'imageMessage') {
                        const message = m.quoted ? m.quoted : m;
                        const buff = await client.downloadMediaMessage(message);
                        const data = new Sticker(buff, {
                            packname, author: stickerAuthor, packId: '', categories,
                        }, crop);
                        await client.sendMessage(m.chat, await data.toMessage(), { quoted: m });
                    } else if (m.mtype == 'videoMessage' || m.quoted && m.quoted.mtype == 'videoMessage') {
                        if (m.quoted ? m.quoted.seconds > 15 : m.message.videoMessage.seconds > 15) return m.reply('too long duration, max 15 seconds');
                        const message = m.quoted ? m.quoted : m;
                        const buff = await client.downloadMediaMessage(message);
                        const data = new Sticker(buff, {
                            packname, author: stickerAuthor, packId: '', categories,
                        });
                        await client.sendMessage(m.chat, await data.toMessage(), { quoted: m });
                    } else if (m.quoted && m.quoted.mtype == 'stickerMessage' && !m.quoted.isAnimated) {
                        const buff = await client.downloadMediaMessage(m.quoted);
                        const data = new Sticker(buff, {
                            packname, author: stickerAuthor, packId: '', categories,
                        }, crop);
                        await client.sendMessage(m.chat, await data.toMessage(), { quoted: m });
                    } else if (isUrl(url)) {
                        const data = new Sticker(url, {
                            packname, author: stickerAuthor, packId: '', categories,
                        }, crop);
                        await client.sendMessage(m.chat, await data.toMessage(), { quoted: m });
                    } else if (flags.find((v) => v.match(/args|help/))) {
                        m.reply(`*list argumen :*\n\n${cropStyle.map((x) => `--${x}`).join('\n')}\n\nexample : ${prefix + cmd} --circle`);
                    } else {
                        m.reply(`send/reply media. media is video or image\n\nexample :\n${prefix}sticker https://s.id/REl2\n${prefix}sticker send/reply media\n\nor you can add --args\n*list argumen :*\n\n${cropStyle.map((x) => `--${x}`).join('\n')}\n\nexample : ${prefix + cmd} --circle`);
                    }
                } catch (error) {
                    m.reply(util.format(error));
                    console.log(error);
                }
                break;
            default:
                break;
            }
        } catch (error) {
            console.log(color('[ERROR]', 'red'), color(moment().format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), error);
        }
    });

    client.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        console.log(update);
        if (connection === 'connecting') {
            console.log(color('[SYS]', '#009FFF'), color(moment().format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), color(`${pkg.name} is Authenticating...`, '#f12711'));
        } else if (connection === 'close') {
            const log = (msg) => console.log(color('[SYS]', '#009FFF'), color(moment().format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), color(msg, '#f64f59'));
            const statusCode = lastDisconnect.error ? new Boom(lastDisconnect)?.output.statusCode : 0;

            console.log(lastDisconnect.error);
            console.log(statusCode);
            if (statusCode === DisconnectReason.badSession) { log(`Bad session file, delete ${config.session} and run again`); start(); } else if (statusCode === DisconnectReason.connectionClosed) { log('Connection closed, reconnecting....'); start(); } else if (statusCode === DisconnectReason.connectionLost) { log('Connection lost, reconnecting....'); start(); } else if (statusCode === DisconnectReason.connectionReplaced) { log('Connection Replaced, Another New Session Opened, Please Close Current Session First'); process.exit(); } else if (statusCode === DisconnectReason.loggedOut) { log(`Device Logged Out, Please Delete ${config.session} and Scan Again.`); fs.unlinkSync(config.session); start(); } else if (statusCode === DisconnectReason.restartRequired) { log('Restart required, restarting...'); start(); } else if (statusCode === DisconnectReason.timedOut) { log('Connection timedOut, reconnecting...'); start(); } else {
                console.log(lastDisconnect.error); start();
            }
        } else if (connection === 'open') {
            console.log(
                color('[SYS]', '#009FFF'),
                color(moment().format('DD/MM/YY HH:mm:ss'), '#A1FFCE'),
                color(`${pkg.name} is now Connected...`, '#38ef7d'),
            );
            // do not online status
            setInterval(async () => {
                await client.sendPresenceUpdate('unavailable', client.user.id);
            }, 10000);
        }
    });
    // listen for when the auth credentials is updated
    client.ev.on('creds.update', await saveCreds);

    return client;
};

start();
