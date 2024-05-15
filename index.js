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
const { Boom } = require("@hapi/boom");
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const dotenv = require('dotenv');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const qrcode = require("qrcode");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;

// Enable file uploads
app.use(fileUpload({ createParentPath: true }));

// Configure message generation
const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048
};

// Safety settings for model response
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// History for the model response
let chatHistory = [
    { role: "user", parts: [{ text: "Kamu adalah Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] },
    { role: "model", parts: [{ text: "Halo, aku Veronisa dirancang oleh fazriansyah.my.id. Asisten yang sangat membantu, kreatif, pintar, dan ramah." }] },
];

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/assets", express.static(path.join(__dirname, "client", "assets")));
app.get("/scan", (req, res) => res.sendFile(path.join(__dirname, "client", "server.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: "silent" }),
        version,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
    });
    store.bind(sock.ev);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect.error).output.statusCode;
            handleDisconnect(reason);
        } else if (connection === 'open') {
            console.log('Opened connection');
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

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "notify" && !messages[0].key.fromMe) {
            const messageContent = messages[0].message.conversation || messages[0].message.extendedTextMessage?.text;
            const incomingMessage = messageContent.toLowerCase();
            const sender = messages[0].key.remoteJid;

            if (!incomingMessage) return;

            try {
                await sock.readMessages([messages[0].key]);
                await sock.sendPresenceUpdate('composing', sender);
                const response = await handleMessage(incomingMessage);
                await sock.sendMessage(sender, { text: response }, { quoted: messages[0] });
            } catch (error) {
                console.error('Error:', error);
                await sock.sendMessage(sender, { text: `Error: ${error.message}` }, { quoted: messages[0] });
            }
        }
    });
}

function handleDisconnect(reason) {
    switch (reason) {
        case DisconnectReason.badSession:
            console.log("Bad Session File, Please Delete session and Scan Again");
            sock.logout();
            break;
        case DisconnectReason.connectionClosed:
            console.log("Connection closed, reconnecting...");
            connectToWhatsApp();
            break;
        case DisconnectReason.connectionLost:
            console.log("Connection Lost from Server, reconnecting...");
            connectToWhatsApp();
            break;
        case DisconnectReason.connectionReplaced:
            console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
            sock.logout();
            break;
        case DisconnectReason.loggedOut:
            console.log("Device Logged Out, Please Delete session and Scan Again.");
            sock.logout();
            break;
        case DisconnectReason.restartRequired:
            console.log("Restart Required, Restarting...");
            connectToWhatsApp();
            break;
        case DisconnectReason.timedOut:
            console.log("Connection TimedOut, Reconnecting...");
            connectToWhatsApp();
            break;
        default:
            sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
    }
}

async function handleMessage(incomingMessage) {
    const chat = model.startChat({
        generationConfig,
        safetySettings,
        history: chatHistory,
    });

    const result = await chat.sendMessage(incomingMessage);
    const response = await result.response;
    const text = response.text();
    console.log(text);

    // Update chat history with the latest user message and the model's response
    chatHistory.push({ role: "user", parts: [{ text: incomingMessage }] });
    chatHistory.push({ role: "model", parts: [{ text }] });

    return text;
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

const isConnected = () => {
    return sock && sock.user;
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
            soket?.emit("log", "WhatsApp connected!");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code has been scanned!");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code, please wait!");
            break;
        default:
            break;
    }
};

connectToWhatsApp().catch(err => console.log("Unexpected error: " + err));

server.listen(port, () => {
    console.log("Server running on port: " + port);
});
