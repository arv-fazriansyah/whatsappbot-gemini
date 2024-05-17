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

const pino = require("pino");
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
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;

dotenv.config();

const allowedGroupJIDs = process.env.GROUP_ID;
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.MODEL });

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;
let chatHistory = {};

const generationConfig = {
    temperature: process.env.TEMPERATURE,
    topP: process.env.TOP_P,
    topK: process.env.TOP_K,
    maxOutputTokens: process.env.MAX_TOKEN,
};

app.use(fileUpload({ createParentPath: true }));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/assets", express.static(path.join(__dirname, "client", "assets")));
app.get("/scan", (req, res) => res.sendFile(path.join(__dirname, "client", "server.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: "silent" }),
        version,
        shouldIgnoreJid: isJidBroadcast,
    });

    store.bind(sock.ev);
    sock.multi = true;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect.error).output.statusCode;
            handleDisconnect(reason);
        } else if (connection === 'open') {
            console.log('opened connection');
            const groups = Object.values(await sock.groupFetchAllParticipating());
            groups.forEach(group => console.log(`id_group: ${group.id} || Nama Group: ${group.subject}`));
        }

        if (update.qr) {
            qr = update.qr;
            updateQR("qr");
        } else if (qr === undefined) {
            updateQR("loading");
        } else if (update.connection === "open") {
            updateQR("qrscanned");
        }
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", handleMessageUpsert);
}

function handleDisconnect(reason) {
    const disconnectReasons = {
        [DisconnectReason.badSession]: () => {
            console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
            sock.logout();
        },
        [DisconnectReason.connectionClosed]: reconnect,
        [DisconnectReason.connectionLost]: reconnect,
        [DisconnectReason.connectionReplaced]: () => {
            console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
            sock.logout();
        },
        [DisconnectReason.loggedOut]: () => {
            console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
            sock.logout();
        },
        [DisconnectReason.restartRequired]: reconnect,
        [DisconnectReason.timedOut]: reconnect,
        default: () => sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`)
    };

    (disconnectReasons[reason] || disconnectReasons.default)();
}

function reconnect() {
    console.log("Connection closed, reconnecting....");
    connectToWhatsApp();
}

async function handleMessageUpsert({ messages, type }) {
    if (type === "notify" && !messages[0].key.fromMe) {
        const message = messages[0];
        const sender = message.key.remoteJid;

        if (!allowedGroupJIDs.includes(sender)) {
            return;
        }

        const messageContent = message.message.conversation || message.message.extendedTextMessage?.text;
        if (!messageContent) return;

        const incomingMessage = messageContent.toLowerCase();
        const formattedSender = `+${sender.match(/\d+/)[0]}`;

        await sock.readMessages([message.key]);
        await sock.sendPresenceUpdate("composing", sender);

        if (incomingMessage === "/new") {
            await sock.sendMessage(sender, { text: `Conversation ID: ${formattedSender}` }, { quoted: message });
        } else {
            if (!chatHistory[sender]) {
                chatHistory[sender] = [
                    { role: "user", parts: [{ text: `Halo, nama saya: ${message.pushName}` }] },
                    { role: "model", parts: [{ text: "Halo, aku Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] }
                ];
            }

            const chat = model.startChat({ generationConfig, history: chatHistory[sender] });
            const result = await chat.sendMessage(incomingMessage);
            const response = (await result.response).text().replace(/\*\*/g, '*');

            if (!response) {
                await sock.sendMessage(sender, { text: "Maaf, terjadi kesalahan. Silakan coba lagi." }, { quoted: message });
                delete chatHistory[sender];
            } else {
                console.log(JSON.stringify(chatHistory[sender]));
                await sock.sendMessage(sender, { text: response }, { quoted: message });
            }
        }
    }
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

const isConnected = () => sock?.user;

const updateQR = (data) => {
    const qrStatusUpdates = {
        qr: () => qrcode.toDataURL(qr, (err, url) => {
            soket?.emit("qr", url);
            soket?.emit("log", "QR Code received, please scan!");
        }),
        connected: () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
        },
        qrscanned: () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
        },
        loading: () => {
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code, please wait!");
        },
        default: () => {}
    };

    (qrStatusUpdates[data] || qrStatusUpdates.default)();
};

connectToWhatsApp().catch(err => console.log("unexpected error: " + err));

server.listen(port, () => {
    console.log("Server running on port:", port);
});
