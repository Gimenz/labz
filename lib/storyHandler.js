/* eslint-disable no-unused-expressions */
const { getContentType, jidDecode } = require('@adiwajshing/baileys');
const moment = require('moment-timezone');
const fs = require('fs');
const drive = require('./drive');
const { color } = require('../utils');

/**
 * anu
 * @param {WAProto.WebMessageInfo} m
 */
async function driveUpload(m) {
    const type = getContentType(m.message);
    const t = m.messageTimestamp;
    const sender = m.sender;
    const contactName = m.pushName || '';
    waktu = moment(t * 1000).format('HH.mm.ss');
    tanggal = moment(t * 1000).format('DD.MM.YYYY');
    if (type == 'extendedTextMessage' || type == 'imageMessage' || type == 'videoMessage') {
        // declare list for save filepath name
        global.list = [];
        // text caption
        const caption = type == 'extendedTextMessage' ? m.message.extendedTextMessage?.text : (m.message.imageMessage || m.message.videoMessage)?.caption || '';
        console.log(color('[STORY]', 'yellow'), color(moment(t * 1000).format('DD/MM/YY HH:mm:ss'), '#A1FFCE'), caption, color(`~> ${type} from`), color(contactName, 'magenta'));

        /** DIRECTORY MANAGER */
        // parentFolderName [user folder name]
        const parentFolderName = `${jidDecode(sender).user}_${contactName.replace(/\W+?/g, '_')}`;
        // child folder name is a story posted date
        const childFolderName = `${tanggal}_${jidDecode(sender).user}`;
        // path media, if a user not in temp folder before
        const pathMedia = `./tmp/${parentFolderName}`;

        // create path media foler if a user not in temp folder before
        if (!fs.existsSync(pathMedia)) { fs.mkdirSync(pathMedia); }
        // filename to save in local dir
        const filename = `${pathMedia}/${waktu}`;
        // path to caption, this used to save caption file
        const captionPath = `${filename}_caption.txt`;

        // save file if type is text stories
        if (type == 'extendedTextMessage') {
            const { font, text, backgroundArgb } = m.message.extendedTextMessage;
            const caption = `${text}\n${'-'.repeat(25)}\nBackground: #${backgroundArgb.toString(16)}\nFont: ${font}\njid: ${sender}`;
            const textPath = `${filename}_textStories.txt`;
            fs.writeFileSync(textPath, caption, 'utf-8');
            global.list[parentFolderName] = [
                [textPath],
            ];
        }

        // save file if type is media message
        if (type !== 'extendedTextMessage') {
            // if stories has a caption, save file and add to list[]
            if (caption !== undefined) {
                fs.writeFileSync(captionPath, caption, 'utf-8');
                global.list[parentFolderName] = [
                    [captionPath],
                ];
            }
            // download mediaMessage and save to local dir
            const downloaded = await client.downloadMediaMessage(m, filename);
            // if media not in list[], add to list. or if caption not in list[]
            global.list[parentFolderName] == undefined
                ? global.list[parentFolderName] = [filelist = [downloaded]]
                : global.list[parentFolderName][0].push(downloaded);
        }

        // check parent folder (parent folder is contact name)
        const checkParentFolder = await drive.checkFolderExists(parentFolderName);
        let parentFolderId;
        if (!checkParentFolder.exists) {
            const create = await drive.createFolder(parentFolderName);
            parentFolderId = create.id;
        } else {
            parentFolderId = checkParentFolder.id;
        }

        // check child folder (child folder is date while stories is posted)
        const checkChildFolder = await drive.checkFolderExists(childFolderName);
        let childFolderId;
        if (!checkChildFolder.exists) {
            const create = await drive.createFolder(childFolderName, parentFolderId);
            childFolderId = create.id;
        } else {
            childFolderId = checkChildFolder.id;
        }

        // add google drive childFolderId to list[]
        global.list[parentFolderName].push(childFolderId);

        // upload to google drive from file list[]
        global.list[parentFolderName][0].map(async (v) => {
            await drive.uploadFile(v, list[parentFolderName][1]).then(() => {
                try {
                    fs.unlinkSync(v);
                } catch (error) {
                    console.log(error);
                }
            });
        });

        // delete list[] if the file has ben uploaded to google drive
        delete list[parentFolderName];
    }
}

module.exports = {
    driveUpload,
};
