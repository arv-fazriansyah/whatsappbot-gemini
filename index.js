const {
    default: makeWASocket,
    MessageType,
    MessageOptions,
    Mimetype,
    DisconnectReason,
    BufferJSON,
    AnyMessageContent,
    delay,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    MessageRetryMap,
    useMultiFileAuthState,
    msgRetryCounterMap
} = require("@whiskeysockets/baileys");

const log = (pino = require("pino"));
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { session } = { "session": "baileys_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const app = require("express")()

dotenv.config();
app.use(cors());
app.use(bodyParser.json());
app.use(fileUpload({createParentPath: true}));
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");
const { error } = require("console");

app.use("/assets", express.static(path.join(__dirname, "client", "assets")));
app.get("/scan", (req, res) => res.sendFile(path.join(__dirname, "client", "server.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.MODEL });

const generationConfig = {
    temperature: process.env.TEMPERATURE,
    topP: process.env.TOP_P,
    topK: process.env.TOP_K,
    maxOutputTokens: process.env.MAX_TOKEN,
};

let sock;
let qr;
let soket;
let chatHistory = {};
let allowContactsCheck = process.env.ALLOWEDCONTACTS === 'true';

async function updatePresence(sock, message, sender) {
    await sock.readMessages([message.key]);
    await sock.sendPresenceUpdate("composing", sender);
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    let { version, isLatest } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: log({ level: "silent" }),
        version,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
    });
    store.bind(sock.ev);
    sock.multi = true
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect.error).output.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
                sock.logout();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log("Connection closed, reconnecting....");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log("Connection Lost from Server, reconnecting...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
                sock.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
                sock.logout();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log("Restart Required, Restarting...");
                connectToWhatsApp();
            } else if (reason === DisconnectReason.timedOut) {
                console.log("Connection TimedOut, Reconnecting...");
                connectToWhatsApp();
            } else {
                sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
            }
        } else if (connection === 'open') {
            console.log('opened connection');
            let getGroups = await sock.groupFetchAllParticipating();
            let groups = Object.values(await sock.groupFetchAllParticipating())
            for (let group of groups) {
                console.log("GROUP_ID: " + group.id + " || GROUP_NAME: " + group.subject);
            }
            return;
        }
        if (update.qr) {
            qr = update.qr;
            updateQR("qr");
        }
        else if (qr = undefined) {
            updateQR("loading");
        }
        else {
            if (update.connection === "open") {
                updateQR("qrscanned");
                return;
            }
        }
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        try {
            if (type !== "notify") return;
    
            const message = messages[0];
            const sender = message.key.remoteJid;
            const formattedSender = `+${sender.match(/\d+/)[0]}`;
    
            if (!message.key.fromMe) {
                const messageContent = message.message.conversation || (message.message.extendedTextMessage && message.message.extendedTextMessage.text);
                if (!messageContent) return;
    
                console.log("CONTACTS_ID: " + sender + " || NAME: " + message.pushName);
    
                const allowedGroups = process.env.GROUP_ID;
                const allowedContacts = process.env.CONTACTS_ID;
                const isGroupMessage = sender.endsWith("@g.us");
    
                if (isGroupMessage && !allowedGroups.includes(sender)) {
                    return;
                } else if (!isGroupMessage && allowContactsCheck) {
                    if (!allowedContacts.includes(sender)) {
                        await updatePresence(sock, message, sender);
                        await sock.sendMessage(sender, { text: `Maaf, ID: ${formattedSender} tidak terdaftar.` });
                        return;
                    }
                }
    
                await updatePresence(sock, message, sender);
                const incomingMessage = messageContent.toLowerCase();
    
                if (incomingMessage === "/new") {
                    await sock.sendMessage(sender, { text: `Conversation ID: ${formattedSender}` }, { quoted: message });
                } else {
                    if (!chatHistory[sender]) {
                        chatHistory[sender] = [
                            { role: "user", parts: [{ text: `Halo, nama saya: ${message.pushName}` }] },
                            { role: "model", parts: [{ text: "Halo, aku Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] },
                        ];
                    }
    
                    const chat = model.startChat({ generationConfig, history: chatHistory[sender] });
                    const result = await chat.sendMessage(incomingMessage);
                    const response = result.response.text().replace(/\*\*/g, '*');
    
                    if (!response) {
                        await sock.sendMessage(sender, { text: "Maaf, terjadi kesalahan. Silakan coba lagi." }, { quoted: message });
                        delete chatHistory[sender];
                    } else {
                        await sock.sendMessage(sender, { text: response }, { quoted: message });
                    }
                }
            }
        } catch (error) {
            console.error("Error occurred:", error);
            await sock.sendMessage(sender, { text: error.message });
        }
    });                     
                    
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

const isConnected = () => {
    return (sock.user);
};

const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
            break;
        default:
            break;
    }
};

connectToWhatsApp()
    .catch(err => console.log("unexpected error: " + err))
server.listen(port, () => {
    console.log("Server running on port:", port);
});
